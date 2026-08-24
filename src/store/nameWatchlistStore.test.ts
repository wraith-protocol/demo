import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('name auction watchlist', () => {
  beforeEach(() => {
    vi.resetModules();
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { localStorage: storage });
  });

  it('restores watched auctions and sealed bid recovery data', async () => {
    const { useNameWatchlistStore } = await import('./nameWatchlistStore');
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
});
