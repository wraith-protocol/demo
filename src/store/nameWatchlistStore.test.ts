import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

class MockWindow {
  localStorage: Storage;
  private listeners: Map<string, ((e: StorageEvent) => void)[]> = new Map();

  constructor(storage: Storage) {
    this.localStorage = storage;
  }

  addEventListener(event: string, listener: (e: StorageEvent) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener);
  }

  removeEventListener(event: string, listener: (e: StorageEvent) => void) {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      const index = eventListeners.indexOf(listener);
      if (index > -1) {
        eventListeners.splice(index, 1);
      }
    }
  }

  dispatchEvent(event: StorageEvent) {
    const eventListeners = this.listeners.get(event.type);
    if (eventListeners) {
      eventListeners.forEach((listener) => listener(event));
    }
  }
}

describe('name auction watchlist', () => {
  beforeEach(() => {
    vi.resetModules();
    const storage = new MemoryStorage();
    const mockWindow = new MockWindow(storage);
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', mockWindow);
  });

  afterEach(async () => {
    const { cleanupNameWatchlistSync } = await import('./nameWatchlistStore');
    cleanupNameWatchlistSync();
  });

  it('restores watched auctions and sealed bid recovery data', async () => {
    const { useNameWatchlistStore, initNameWatchlistSync } = await import('./nameWatchlistStore');
    initNameWatchlistSync();
    const store = useNameWatchlistStore.getState();
    store.watchAuction({ name: 'NOVA', endsAt: 1_800_000_000 });
    store.saveBid({
      name: 'NOVA',
      amountStroops: '25000000',
      depositStroops: '25000000',
      saltHex: 'ab'.repeat(32),
      revealed: false,
    });

    const persisted = localStorage.getItem('wraith-name-auction-watchlist');
    expect(persisted).not.toBeNull();
    useNameWatchlistStore.setState({ watchedAuctions: [], bids: {} });
    localStorage.setItem('wraith-name-auction-watchlist', persisted!);
    await useNameWatchlistStore.persist.rehydrate();

    expect(useNameWatchlistStore.getState().watchedAuctions).toEqual([
      { name: 'nova', endsAt: 1_800_000_000 },
    ]);
    expect(useNameWatchlistStore.getState().bids.nova).toMatchObject({
      amountStroops: '25000000',
      saltHex: 'ab'.repeat(32),
      revealed: false,
    });
  });

  it('recovers from corrupt and unknown-version persisted data', async () => {
    localStorage.setItem('wraith-name-auction-watchlist', '{not-json');
    const { useNameWatchlistStore, initNameWatchlistSync } = await import('./nameWatchlistStore');
    initNameWatchlistSync();
    await useNameWatchlistStore.persist.rehydrate();
    expect(useNameWatchlistStore.getState().watchedAuctions).toEqual([]);
    expect(useNameWatchlistStore.getState().bids).toEqual({});

    localStorage.setItem(
      'wraith-name-auction-watchlist',
      JSON.stringify({
        version: 99,
        state: { watchedAuctions: [{ name: 'future', endsAt: 1 }], bids: {} },
      }),
    );
    await useNameWatchlistStore.persist.rehydrate();
    expect(useNameWatchlistStore.getState().watchedAuctions).toEqual([]);
  });
});
