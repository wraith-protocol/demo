import type { PreparedChainSubmission, PrepareContext } from './submissionIdempotency';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const previousStorage = globalThis.localStorage;

/** Installs a fresh in-memory `localStorage` that survives simulated reloads. */
export function useMemoryStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
}

export function restoreStorage(): void {
  if (previousStorage === undefined) {
    Reflect.deleteProperty(globalThis, 'localStorage');
  } else {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previousStorage,
    });
  }
}

export function timeoutError(): Error {
  const error = new TypeError('Failed to fetch: request timed out');
  return error;
}

/** Records every `prepare` invocation so tests can assert nothing was rebuilt. */
export function trackPrepare(
  build: (context: PrepareContext, attempt: number) => PreparedChainSubmission,
) {
  const calls: PrepareContext[] = [];
  const prepare = async (context: PrepareContext) => {
    calls.push(context);
    return build(context, calls.length);
  };
  return { prepare, calls };
}
