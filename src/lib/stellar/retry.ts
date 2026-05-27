export class StellarRetryExhaustedError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super('Network unstable — try again.');
    this.name = 'StellarRetryExhaustedError';
    this.cause = cause;
  }
}

export type RetryEvent = { attempt: number; error: unknown; delayMs: number };
export type OnRetry = (event: RetryEvent) => void;

export interface RetryOptions {
  attempts?: number;
  signal?: AbortSignal;
  onRetry?: OnRetry;
}

const RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504]);

function isRetryable(err: unknown): boolean {
  if (err instanceof StellarRetryExhaustedError) return false;

  // Aborted — respect the signal, don't retry
  if (err instanceof DOMException && err.name === 'AbortError') return false;

  // Network / fetch errors (TypeError: Failed to fetch, etc.)
  if (err instanceof TypeError) return true;

  if (err instanceof Error) {
    // JSON parse errors (RPC returned HTML on overload)
    if (err instanceof SyntaxError) return true;

    // HTTP status errors — only retry specific codes
    const match = err.message.match(/\b(\d{3})\b/);
    if (match) {
      const status = parseInt(match[1], 10);
      // 4xx not in allowlist → don't retry
      if (status >= 400 && status < 500 && !RETRYABLE_STATUS.has(status)) return false;
      return RETRYABLE_STATUS.has(status);
    }
  }

  return true;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}

export async function withRetry<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  { attempts = 4, signal, onRetry }: RetryOptions = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    try {
      return await fn(signal);
    } catch (err) {
      lastError = err;

      if (!isRetryable(err) || attempt === attempts) break;

      // Exponential backoff: 200, 400, 800, 1600 ms ±25%
      const base = 200 * Math.pow(2, attempt - 1);
      const jitter = base * 0.25 * (Math.random() * 2 - 1);
      const delayMs = Math.round(base + jitter);

      onRetry?.({ attempt, error: err, delayMs });

      await delay(delayMs, signal);
    }
  }

  throw new StellarRetryExhaustedError(lastError);
}
