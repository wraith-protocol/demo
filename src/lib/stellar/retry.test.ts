import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import {
  withRetry,
  fetchWithRetry,
  HttpError,
  RetryExhaustedError,
  isRetryableError,
} from './retry';

// ── withRetry ──────────────────────────────────────────────────────────────

describe('withRetry', () => {
  it('resolves immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    expect(await withRetry(fn)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on TypeError (network error) and succeeds', async () => {
    vi.useFakeTimers();
    const fn = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue('ok');

    const promise = withRetry(fn, { baseDelayMs: 0 });
    await vi.runAllTimersAsync();

    expect(await promise).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it.each([408, 429, 502, 503, 504])('retries on HttpError %d', async (status) => {
    vi.useFakeTimers();
    const fn = vi.fn()
      .mockRejectedValueOnce(new HttpError(status, `HTTP ${status}`))
      .mockResolvedValue('ok');

    const promise = withRetry(fn, { baseDelayMs: 0 });
    await vi.runAllTimersAsync();

    expect(await promise).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not retry on non-retryable errors', async () => {
    const err = new Error('Hard failure');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry on non-retryable HttpError (404)', async () => {
    const fn = vi.fn().mockRejectedValue(new HttpError(404, 'Not Found'));
    await expect(withRetry(fn)).rejects.toBeInstanceOf(HttpError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws RetryExhaustedError after maxAttempts', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 0 });
    await Promise.all([
      expect(promise).rejects.toBeInstanceOf(RetryExhaustedError),
      vi.runAllTimersAsync(),
    ]);
    expect(fn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('RetryExhaustedError message includes attempt count', async () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockRejectedValue(new TypeError('net'));

    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 0 });
    await Promise.all([
      expect(promise).rejects.toThrow('Connection failed after 3 attempts — try again.'),
      vi.runAllTimersAsync(),
    ]);
    vi.useRealTimers();
  });

  it('calls onRetry with correct next attempt number before each delay', async () => {
    vi.useFakeTimers();
    const fn = vi.fn()
      .mockRejectedValueOnce(new TypeError('net'))
      .mockRejectedValueOnce(new TypeError('net'))
      .mockResolvedValue('ok');

    const onRetry = vi.fn();
    const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 0, onRetry });
    await vi.runAllTimersAsync();

    expect(await promise).toBe('ok');
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0]).toBe(2);
    expect(onRetry.mock.calls[1][0]).toBe(3);
    vi.useRealTimers();
  });

  it('does not call fn when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn().mockResolvedValue('ok');

    await expect(withRetry(fn, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it('jitter keeps delay in [baseDelayMs, 2 * baseDelayMs) on first retry', async () => {
    vi.useFakeTimers();
    const recorded: number[] = [];
    const fn = vi.fn()
      .mockRejectedValueOnce(new TypeError('net'))
      .mockResolvedValue('ok');

    const promise = withRetry(fn, {
      baseDelayMs: 200,
      onRetry: (_, delayMs) => recorded.push(delayMs),
    });
    await vi.runAllTimersAsync();
    await promise;

    // attempt=1: delay = min(200 * 2^0 + jitter, 30000), jitter in [0, 200)
    expect(recorded[0]).toBeGreaterThanOrEqual(200);
    expect(recorded[0]).toBeLessThan(400);
    vi.useRealTimers();
  });
});

// ── isRetryableError ───────────────────────────────────────────────────────

describe('isRetryableError', () => {
  it('returns true for TypeError', () => {
    expect(isRetryableError(new TypeError('Failed to fetch'))).toBe(true);
  });
  it('returns true for retryable HttpError', () => {
    expect(isRetryableError(new HttpError(503, 'Bad gateway'))).toBe(true);
  });
  it('returns false for 404 HttpError', () => {
    expect(isRetryableError(new HttpError(404, 'Not Found'))).toBe(false);
  });
  it('returns false for generic Error', () => {
    expect(isRetryableError(new Error('nope'))).toBe(false);
  });
});

// ── fetchWithRetry ─────────────────────────────────────────────────────────

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

describe('fetchWithRetry', () => {
  it('returns 200 on first success', async () => {
    server.use(
      http.get('https://horizon.test/accounts/G1', () =>
        HttpResponse.json({ balance: '100' }),
      ),
    );
    const res = await fetchWithRetry('https://horizon.test/accounts/G1');
    expect(res.ok).toBe(true);
  });

  it('returns 404 without retrying (non-retryable)', async () => {
    let calls = 0;
    server.use(
      http.get('https://horizon.test/accounts/G1', () => {
        calls++;
        return new HttpResponse(null, { status: 404 });
      }),
    );
    const res = await fetchWithRetry('https://horizon.test/accounts/G1', {}, { baseDelayMs: 0 });
    expect(res.status).toBe(404);
    expect(calls).toBe(1);
  });

  it('retries on 503 and succeeds on second call', async () => {
    vi.useFakeTimers();
    let calls = 0;
    server.use(
      http.get('https://horizon.test/accounts/G2', () => {
        calls++;
        return calls === 1 ? new HttpResponse(null, { status: 503 }) : HttpResponse.json({});
      }),
    );

    const promise = fetchWithRetry('https://horizon.test/accounts/G2', {}, { baseDelayMs: 0 });
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.ok).toBe(true);
    expect(calls).toBe(2);
    vi.useRealTimers();
  });

  it('throws RetryExhaustedError after 3 x 503', async () => {
    vi.useFakeTimers();
    server.use(
      http.get('https://horizon.test/accounts/G3', () =>
        new HttpResponse(null, { status: 503 }),
      ),
    );

    const promise = fetchWithRetry(
      'https://horizon.test/accounts/G3',
      {},
      { maxAttempts: 3, baseDelayMs: 0 },
    );
    await Promise.all([
      expect(promise).rejects.toBeInstanceOf(RetryExhaustedError),
      vi.runAllTimersAsync(),
    ]);
    vi.useRealTimers();
  });
});
