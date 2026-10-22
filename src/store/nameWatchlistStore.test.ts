import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUCTION_STORAGE_KEY,
  MIN_PBKDF2_ITERATIONS,
  VAULT_STORAGE_KEY,
  createBackup,
  encryptBids,
  type AuctionBid,
} from '@/lib/auctionEncryption';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  failWrites = false;
  corruptNextWrite = false;
  readonly operations: string[] = [];

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    this.operations.push(`get:${key}`);
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.operations.push(`remove:${key}`);
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.operations.push(`set:${key}`);
    if (this.failWrites) throw new Error('storage quota exceeded');
    if (this.corruptNextWrite) {
      this.corruptNextWrite = false;
      this.values.set(key, `${value} `);
      return;
    }
    this.values.set(key, value);
  }
}

const bid: AuctionBid = {
  name: 'nova',
  amountStroops: '25000000',
  depositStroops: '25000000',
  saltHex: 'ab'.repeat(32),
  revealed: false,
};

const replacementBid: AuctionBid = {
  name: 'orion',
  amountStroops: '75000000',
  depositStroops: '75000000',
  saltHex: 'cd'.repeat(32),
  revealed: false,
};

let storage: MemoryStorage;

async function importStore() {
  return import('./nameWatchlistStore');
}

function legacyValue() {
  return JSON.stringify({
    version: 1,
    type: 'wraith-versioned-value',
    data: {
      watchedAuctions: [{ name: 'nova', endsAt: 1_800_000_000 }],
      bids: { nova: bid },
    },
  });
}

describe('name auction recovery store', () => {
  beforeEach(() => {
    vi.resetModules();
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', {
      localStorage: storage,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(async () => {
    const { cleanupNameWatchlistSync } = await importStore();
    cleanupNameWatchlistSync();
    vi.unstubAllGlobals();
  });

  it('persists encrypted bids only and removes decrypted secrets from memory when locked', async () => {
    const { useNameWatchlistStore } = await importStore();
    const store = useNameWatchlistStore.getState();
    await store.setPassphrase('a sufficiently long passphrase', MIN_PBKDF2_ITERATIONS);
    await useNameWatchlistStore.getState().saveBid(bid);

    const persisted = [
      localStorage.getItem(AUCTION_STORAGE_KEY),
      localStorage.getItem(VAULT_STORAGE_KEY),
    ]
      .filter(Boolean)
      .join('\n');
    expect(persisted).not.toContain(bid.amountStroops);
    expect(persisted).not.toContain(bid.depositStroops);
    expect(persisted).not.toContain(bid.saltHex);
    expect(persisted).not.toContain('a sufficiently long passphrase');
    expect(useNameWatchlistStore.getState().bids.nova).toEqual(bid);

    useNameWatchlistStore.getState().lock();
    expect(useNameWatchlistStore.getState().bids).toEqual({});
    await expect(useNameWatchlistStore.getState().saveBid(bid)).rejects.toThrow(/unlock/i);
  });

  it('migrates legacy secrets without deleting them until explicit confirmation', async () => {
    storage.setItem(AUCTION_STORAGE_KEY, legacyValue());
    const { useNameWatchlistStore } = await importStore();
    const store = useNameWatchlistStore.getState();
    expect(store.status).toBe('legacy');
    expect(store.hasLegacyPlaintext).toBe(true);

    await store.setPassphrase('migration passphrase', MIN_PBKDF2_ITERATIONS);
    const staged = JSON.parse(localStorage.getItem(VAULT_STORAGE_KEY)!);
    expect(staged.data.encryptedBids.data).toBeTruthy();
    expect(localStorage.getItem(AUCTION_STORAGE_KEY)).toBe(legacyValue());
    expect(useNameWatchlistStore.getState().hasLegacyPlaintext).toBe(true);

    await expect(useNameWatchlistStore.getState().clearLegacy()).resolves.toBe(true);
    expect(localStorage.getItem(AUCTION_STORAGE_KEY)).toBeNull();
    expect(useNameWatchlistStore.getState().hasLegacyPlaintext).toBe(false);
    expect(useNameWatchlistStore.getState().bids.nova).toEqual(bid);
  });

  it('recovers encrypted bids after locking and unlocking', async () => {
    const { useNameWatchlistStore } = await importStore();
    await useNameWatchlistStore
      .getState()
      .setPassphrase('recovery passphrase', MIN_PBKDF2_ITERATIONS);
    await useNameWatchlistStore.getState().saveBid(bid);
    useNameWatchlistStore.getState().lock();

    await useNameWatchlistStore.getState().unlock('recovery passphrase');

    expect(useNameWatchlistStore.getState().bids).toEqual({ nova: bid });
    await expect(useNameWatchlistStore.getState().unlock('wrong passphrase')).rejects.toThrow();
    expect(useNameWatchlistStore.getState().bids).toEqual({});
  });

  it('reads a valid encrypted vault whose serialized form exceeds the legacy storage limit', async () => {
    const amountStroops = '1'.repeat(80);
    const bids: Record<string, AuctionBid> = Object.fromEntries(
      Array.from({ length: 280 }, (_, index) => {
        const name = `bid${index}`;
        return [
          name,
          {
            name,
            amountStroops,
            depositStroops: amountStroops,
            saltHex: (index % 256).toString(16).padStart(2, '0').repeat(32),
            revealed: false,
          },
        ];
      }),
    );
    const vault = await encryptBids('large vault passphrase', bids, MIN_PBKDF2_ITERATIONS);
    const serialized = JSON.stringify(vault);
    expect(serialized.length).toBeGreaterThan(100_000);
    storage.setItem(VAULT_STORAGE_KEY, serialized);

    const { useNameWatchlistStore } = await importStore();

    expect(useNameWatchlistStore.getState().status).toBe('locked');
    expect(useNameWatchlistStore.getState().hasEncryptedVault).toBe(true);
  });

  it('verifies encrypted recovery storage read-back before resolving a saved bid', async () => {
    const { useNameWatchlistStore } = await importStore();
    await useNameWatchlistStore
      .getState()
      .setPassphrase('commit passphrase', MIN_PBKDF2_ITERATIONS);
    await useNameWatchlistStore.getState().saveBid(bid);

    const lastWrite = storage.operations.lastIndexOf(`set:${AUCTION_STORAGE_KEY}`);
    expect(lastWrite).toBeGreaterThanOrEqual(0);
    expect(storage.operations.lastIndexOf(`get:${AUCTION_STORAGE_KEY}`)).toBeGreaterThan(lastWrite);
    expect(useNameWatchlistStore.getState().bids).toEqual({ nova: bid });
  });

  it('updates watched auctions synchronously and restores state after persistence failure', async () => {
    const { useNameWatchlistStore } = await importStore();
    const watch = useNameWatchlistStore.getState().watchAuction({ name: 'nova', endsAt: 100 });

    expect(useNameWatchlistStore.getState().watchedAuctions).toEqual([
      { name: 'nova', endsAt: 100 },
    ]);
    await watch;

    storage.failWrites = true;
    const failedWatch = useNameWatchlistStore
      .getState()
      .watchAuction({ name: 'orion', endsAt: 200 });
    expect(useNameWatchlistStore.getState().watchedAuctions).toHaveLength(2);
    await expect(failedWatch).rejects.toThrow(/storage quota exceeded/i);
    expect(useNameWatchlistStore.getState().watchedAuctions).toEqual([
      { name: 'nova', endsAt: 100 },
    ]);
  });

  it('does not activate a bid when persistence or read-back verification fails', async () => {
    const { useNameWatchlistStore } = await importStore();
    await useNameWatchlistStore
      .getState()
      .setPassphrase('storage passphrase', MIN_PBKDF2_ITERATIONS);

    storage.failWrites = true;
    await expect(useNameWatchlistStore.getState().saveBid(bid)).rejects.toThrow(
      /storage quota exceeded/i,
    );
    expect(useNameWatchlistStore.getState().bids).toEqual({});

    storage.failWrites = false;
    storage.corruptNextWrite = true;
    await expect(useNameWatchlistStore.getState().saveBid(bid)).rejects.toThrow(/read-back/i);
    expect(useNameWatchlistStore.getState().bids).toEqual({});
  });

  it('refuses silent backup replacement and supports explicit replacement', async () => {
    const { useNameWatchlistStore } = await importStore();
    await useNameWatchlistStore
      .getState()
      .setPassphrase('original passphrase', MIN_PBKDF2_ITERATIONS);
    await useNameWatchlistStore.getState().saveBid(bid);
    const existing = localStorage.getItem(AUCTION_STORAGE_KEY);
    const replacementVault = await encryptBids(
      'backup passphrase',
      { orion: replacementBid },
      MIN_PBKDF2_ITERATIONS,
    );
    const backup = JSON.stringify(createBackup(replacementVault));

    await expect(
      useNameWatchlistStore.getState().importBackup(backup, 'backup passphrase'),
    ).rejects.toThrow(/confirm replacement/i);
    expect(localStorage.getItem(AUCTION_STORAGE_KEY)).toBe(existing);

    await useNameWatchlistStore
      .getState()
      .importBackup(backup, 'backup passphrase', { replace: true });
    expect(useNameWatchlistStore.getState().bids).toEqual({ orion: replacementBid });
  });

  it('preserves the current vault when backup validation or persistence fails', async () => {
    const { useNameWatchlistStore } = await importStore();
    await useNameWatchlistStore
      .getState()
      .setPassphrase('preserve passphrase', MIN_PBKDF2_ITERATIONS);
    await useNameWatchlistStore.getState().saveBid(bid);
    const before = localStorage.getItem(AUCTION_STORAGE_KEY);
    const replacementVault = await encryptBids(
      'backup passphrase',
      { orion: replacementBid },
      MIN_PBKDF2_ITERATIONS,
    );
    const backup = JSON.stringify(createBackup(replacementVault));

    await expect(
      useNameWatchlistStore
        .getState()
        .importBackup('{not-json', 'backup passphrase', { replace: true }),
    ).rejects.toThrow();
    expect(localStorage.getItem(AUCTION_STORAGE_KEY)).toBe(before);
    expect(useNameWatchlistStore.getState().bids).toEqual({ nova: bid });

    storage.failWrites = true;
    await expect(
      useNameWatchlistStore.getState().importBackup(backup, 'backup passphrase', { replace: true }),
    ).rejects.toThrow(/storage quota exceeded/i);
    expect(localStorage.getItem(AUCTION_STORAGE_KEY)).toBe(before);
    expect(useNameWatchlistStore.getState().bids).toEqual({ nova: bid });

    storage.failWrites = false;
    await useNameWatchlistStore.getState().saveBid({ ...bid, amountStroops: '30000000' });
    expect(useNameWatchlistStore.getState().bids.nova.amountStroops).toBe('30000000');
  });
});
