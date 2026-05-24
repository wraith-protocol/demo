import { afterEach, describe, expect, test, vi } from 'vitest';
import { retryFetch, retryFetchJson, StellarRetryExhaustedError, withRetry } from './retry';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('stellar retry helpers', () => {
  test('retries transient HTTP failures with exponential jittered delays and telemetry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const delays: number[] = [];
    const retryAttempts: number[] = [];
    vi.stubGlobal('fetch', fetchMock);

    const response = await retryFetch('/rpc', undefined, {
      sleep: async (ms) => {
        delays.push(ms);
      },
      random: () => 0.5,
      onRetry: ({ attempt }) => retryAttempts.push(attempt),
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([200, 400]);
    expect(retryAttempts).toEqual([1, 2]);
  });

  test('does not retry non-retryable HTTP status responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await retryFetch('/rpc');

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('does not retry malformed non-retryable HTTP error bodies', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('<html>unauthorized</html>', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await retryFetchJson('/rpc');

    expect(result.response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('retries JSON parse failures from overloaded endpoints', async () => {
    const htmlResponse = new Response('<html>bad gateway</html>', { status: 200 });
    const jsonResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse)
      .mockResolvedValueOnce(jsonResponse);
    vi.stubGlobal('fetch', fetchMock);

    const result = await retryFetchJson<{ ok: boolean }>('/rpc', undefined, {
      sleep: async () => {},
    });

    expect(result.data.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('throws StellarRetryExhaustedError with the last error after final attempt', async () => {
    const lastError = new TypeError('network down');

    await expect(
      withRetry(
        async () => {
          throw lastError;
        },
        { attempts: 2, sleep: async () => {} },
      ),
    ).rejects.toMatchObject({
      name: 'StellarRetryExhaustedError',
      lastError,
    } satisfies Partial<StellarRetryExhaustedError>);
  });

  test('respects an already-aborted signal without retrying', async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn();

    await expect(withRetry(fn, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fn).not.toHaveBeenCalled();
  });
});
