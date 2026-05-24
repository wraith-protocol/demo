export type RetryTelemetryEvent = {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: unknown;
};

export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  jitterRatio?: number;
  signal?: AbortSignal;
  onRetry?: (event: RetryTelemetryEvent) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
};

export class StellarRetryExhaustedError extends Error {
  readonly lastError: unknown;

  constructor(lastError: unknown) {
    super('Network unstable — try again.');
    this.name = 'StellarRetryExhaustedError';
    this.lastError = lastError;
  }
}

class RetryableHttpError extends Error {
  constructor(readonly response: Response) {
    super(`Retryable HTTP ${response.status}`);
    this.name = 'RetryableHttpError';
  }
}

const RETRYABLE_STATUSES = new Set([408, 429, 502, 503, 504]);

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 200;
  const jitterRatio = opts.jitterRatio ?? 0.25;
  const sleep = opts.sleep ?? sleepWithAbort;
  const random = opts.random ?? Math.random;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    throwIfAborted(opts.signal);

    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error)) {
        throw error;
      }
      if (attempt >= attempts) {
        throw new StellarRetryExhaustedError(lastError);
      }

      const delayMs = jitteredDelay(baseDelayMs, jitterRatio, attempt, random);
      const event = { attempt, maxAttempts: attempts, delayMs, error };
      opts.onRetry?.(event);
      emitRetryEvent(event);
      await sleep(delayMs, opts.signal);
    }
  }

  throw new StellarRetryExhaustedError(lastError);
}

export async function retryFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts?: RetryOptions,
): Promise<Response> {
  return withRetry(async () => {
    const response = await fetch(input, { ...init, signal: opts?.signal ?? init?.signal });
    if (RETRYABLE_STATUSES.has(response.status)) {
      throw new RetryableHttpError(response);
    }
    return response;
  }, opts);
}

export async function retryFetchJson<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts?: RetryOptions,
): Promise<{ response: Response; data: T }> {
  return withRetry(async () => {
    const response = await fetch(input, { ...init, signal: opts?.signal ?? init?.signal });
    if (RETRYABLE_STATUSES.has(response.status)) {
      throw new RetryableHttpError(response);
    }

    if (!response.ok) {
      try {
        return { response, data: (await response.json()) as T };
      } catch {
        return { response, data: undefined as T };
      }
    }

    return { response, data: (await response.json()) as T };
  }, opts);
}

export function isNetworkUnstableError(error: unknown): error is StellarRetryExhaustedError {
  return error instanceof StellarRetryExhaustedError;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof RetryableHttpError) return true;
  if (error instanceof SyntaxError) return true;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (!(error instanceof Error)) return false;

  return (
    error.name === 'AbortError' ||
    error.name === 'TimeoutError' ||
    error.name === 'TypeError' ||
    error.message.toLowerCase().includes('network')
  );
}

function jitteredDelay(
  baseDelayMs: number,
  jitterRatio: number,
  attempt: number,
  random: () => number,
): number {
  const rawDelay = baseDelayMs * 2 ** (attempt - 1);
  const jitter = rawDelay * jitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.round(rawDelay + jitter));
}

function emitRetryEvent(event: RetryTelemetryEvent) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('stellar:retry', { detail: event }));
}

async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const timeout = globalThis.setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        globalThis.clearTimeout(timeout);
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      },
      { once: true },
    );
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
}
