export const RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504]);

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class RetryExhaustedError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly cause: unknown,
  ) {
    super(`Connection failed after ${attempts} attempt${attempts === 1 ? '' : 's'} — try again.`);
    this.name = 'RetryExhaustedError';
  }
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof HttpError && RETRYABLE_STATUS.has(error.status)) return true;
  return false;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 200, signal, onRetry } = opts;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    try {
      return await fn();
    } catch (error) {
      if (!isRetryableError(error)) throw error;
      if (attempt === maxAttempts) throw new RetryExhaustedError(maxAttempts, error);

      const jitter = Math.random() * baseDelayMs;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1) + jitter, 30_000);
      onRetry?.(attempt + 1, Math.round(delay), error);
      await sleep(delay, signal);
    }
  }

  // Unreachable — loop always returns or throws above
  throw new RetryExhaustedError(maxAttempts, undefined);
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts?: RetryOptions,
): Promise<Response> {
  const signal = opts?.signal ?? init?.signal ?? undefined;
  return withRetry(
    async () => {
      const res = await fetch(input, { ...init, signal });
      if (RETRYABLE_STATUS.has(res.status)) {
        throw new HttpError(res.status, `HTTP ${res.status} ${res.statusText}`);
      }
      return res;
    },
    { ...opts, signal },
  );
}
