import { describe, expect, it } from 'vitest';
import {
  CURRENT_STORAGE_VERSION,
  MAX_STORAGE_BYTES,
  readVersionedCollection,
  readVersionedValue,
  writeVersioned,
} from './versionedStorage';

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

const isRecord = (value: unknown): value is { id: string } =>
  typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string';

describe('versioned local storage', () => {
  it('migrates a legacy collection and writes the current envelope', () => {
    const storage = new MemoryStorage();
    storage.setItem('items', JSON.stringify([{ id: 'legacy' }, { invalid: true }]));

    expect(readVersionedCollection(storage, 'items', isRecord)).toEqual([{ id: 'legacy' }]);
    writeVersioned(storage, 'items', [{ id: 'legacy' }]);
    expect(JSON.parse(storage.getItem('items')!)).toEqual({
      version: CURRENT_STORAGE_VERSION,
      data: [{ id: 'legacy' }],
    });
  });

  it.each(['not-json', JSON.stringify({ version: 99, data: [{ id: 'future' }] })])(
    'recovers from corrupt or unknown-version data (%s)',
    (raw) => {
      const storage = new MemoryStorage();
      storage.setItem('items', raw);
      expect(readVersionedCollection(storage, 'items', isRecord)).toEqual([]);
      expect(storage.getItem('items')).toBeNull();
    },
  );

  it('drops oversized values before parsing them', () => {
    const storage = new MemoryStorage();
    storage.setItem('items', 'x'.repeat(MAX_STORAGE_BYTES + 1));

    expect(readVersionedCollection(storage, 'items', isRecord)).toEqual([]);
    expect(storage.getItem('items')).toBeNull();
  });

  it('migrates a legacy persisted record', () => {
    const storage = new MemoryStorage();
    storage.setItem('state', JSON.stringify({ state: { enabled: true }, version: 0 }));

    expect(
      readVersionedValue(
        storage,
        'state',
        (value): value is { enabled: boolean } =>
          typeof value === 'object' &&
          value !== null &&
          (value as { enabled?: unknown }).enabled === true,
        (value) => (value as { state?: unknown }).state,
      ),
    ).toEqual({ enabled: true });
  });
});
