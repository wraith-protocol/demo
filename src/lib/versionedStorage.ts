export const CURRENT_STORAGE_VERSION = 1;
export const MAX_STORAGE_BYTES = 100_000;
export const MAX_COLLECTION_ITEMS = 500;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface VersionedValue<T> {
  version: number;
  data: T;
}

export function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

export function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function discard(storage: StorageLike, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Storage can be unavailable or quota-restricted; callers still get a safe fallback.
  }
}

function parse<T>(
  storage: StorageLike,
  key: string,
  raw: string,
  validate: (value: unknown) => value is T,
  extractLegacy: (value: unknown) => unknown[] | undefined,
): T[] {
  if (raw.length > MAX_STORAGE_BYTES) {
    discard(storage, key);
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    const versioned = parsed as Partial<VersionedValue<unknown[]>>;
    const hasVersion = typeof versioned.version === 'number';
    const values =
      hasVersion && versioned.version !== CURRENT_STORAGE_VERSION
        ? undefined
        : versioned.version === CURRENT_STORAGE_VERSION && Array.isArray(versioned.data)
          ? versioned.data
          : extractLegacy(parsed);

    if (!values) {
      discard(storage, key);
      return [];
    }

    return values.filter(validate).slice(0, MAX_COLLECTION_ITEMS);
  } catch {
    discard(storage, key);
    return [];
  }
}

export function readVersionedCollection<T>(
  storage: StorageLike,
  key: string,
  validate: (value: unknown) => value is T,
  extractLegacy: (value: unknown) => unknown[] | undefined = (value) =>
    Array.isArray(value) ? value : undefined,
): T[] {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return [];
  }
  return raw === null ? [] : parse(storage, key, raw, validate, extractLegacy);
}

export function readVersionedValue<T>(
  storage: StorageLike,
  key: string,
  validate: (value: unknown) => value is T,
  migrateLegacy: (value: unknown) => unknown = (value) => value,
): T | null {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null || raw.length > MAX_STORAGE_BYTES) {
    if (raw !== null) discard(storage, key);
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    const versioned = parsed as Partial<VersionedValue<unknown>>;
    const hasVersion = typeof versioned.version === 'number';
    const candidate =
      versioned.version === CURRENT_STORAGE_VERSION
        ? versioned.data
        : hasVersion && versioned.version !== 0
          ? undefined
          : migrateLegacy(parsed);
    if (!validate(candidate)) {
      discard(storage, key);
      return null;
    }
    return candidate;
  } catch {
    discard(storage, key);
    return null;
  }
}

export function writeVersioned<T>(storage: StorageLike, key: string, data: T): void {
  try {
    storage.setItem(key, JSON.stringify({ version: CURRENT_STORAGE_VERSION, data }));
  } catch {
    // A full or disabled localStorage must not break application state updates.
  }
}
