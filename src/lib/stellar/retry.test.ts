import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, StellarRetryExhaustedError } from './retry';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Run fn, flush all timers, then return the settled result. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  const p = fn();
  await vi.runAllTimersAsync();
  return p;
}

describe('withRetry', () => {
  it('resolves immediately on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    expect(await run(() => withRetry(fn))).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on TypeError (network error) and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue('ok');
    expect(await run(() => withRetry(fn, { attempts: 4 }))).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on SyntaxError (JSON parse) and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new SyntaxError('Unexpected token'))
      .mockResolvedValue('data');
    expect(await run(() => withRetry(fn, { attempts: 4 }))).toBe('data');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on 429 error and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('HTTP 429 Too Many Requests'))
      .mockResolvedValue('ok');
    expect(await run(() => withRetry(fn, { attempts: 4 }))).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it.each([502, 503, 504])('retries on %i and succeeds', async (status) => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error(`HTTP ${status}`))
      .mockResolvedValue('ok');
    expect(await run(() => withRetry(fn, { attempts: 4 }))).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws StellarRetryExhaustedError after all attempts fail', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await run(() => withRetry(fn, { attempts: 3 }).catch((e) => e));
    expect(err).toBeInstanceOf(StellarRetryExhaustedError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('StellarRetryExhaustedError carries the last error as cause', async () => {
    const cause = new TypeError('Failed to fetch');
    const fn = vi.fn().mockRejectedValue(cause);
    const err = await run(() => withRetry(fn, { attempts: 2 }).catch((e) => e));
    expect(err).toBeInstanceOf(StellarRetryExhaustedError);
    expect((err as StellarRetryExhaustedError).cause).toEqual(cause);
  });

  it('does NOT retry on 400 Bad Request', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('HTTP 400 Bad Request'));
    const err = await run(() => withRetry(fn, { attempts: 4 }).catch((e) => e));
    expect(err).toBeInstanceOf(StellarRetryExhaustedError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 401 Unauthorized', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('HTTP 401 Unauthorized'));
    const err = await run(() => withRetry(fn, { attempts: 4 }).catch((e) => e));
    expect(err).toBeInstanceOf(StellarRetryExhaustedError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on AbortError', async () => {
    const fn = vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    const err = await run(() => withRetry(fn, { attempts: 4 }).catch((e) => e));
    expect(err).toBeInstanceOf(StellarRetryExhaustedError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on StellarRetryExhaustedError itself', async () => {
    const fn = vi.fn().mockRejectedValue(new StellarRetryExhaustedError(new Error('inner')));
    const err = await run(() => withRetry(fn, { attempts: 4 }).catch((e) => e));
    expect(err).toBeInstanceOf(StellarRetryExhaustedError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respects AbortSignal — aborts before first attempt', async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn().mockResolvedValue('ok');
    const err = await run(() => withRetry(fn, { signal: controller.signal }).catch((e) => e));
    expect((err as DOMException).name).toBe('AbortError');
    expect(fn).not.toHaveBeenCalled();
  });

  it('calls onRetry with attempt number and delay', async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue('ok');
    await run(() => withRetry(fn, { attempts: 4, onRetry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, error: expect.any(TypeError) }),
    );
  });

  it('uses default 4 attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('net'));
    const err = await run(() => withRetry(fn).catch((e) => e));
    expect(err).toBeInstanceOf(StellarRetryExhaustedError);
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
