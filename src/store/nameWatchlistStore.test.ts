import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptBids } from '@/lib/auctionEncryption';

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

let storage: MemoryStorage;

beforeEach(() => {
  vi.resetModules();
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', { localStorage: storage });
});

async function loadStore() {
  return await import('./nameWatchlistStore');
}

const legacyPayload = {
  version: 0,
  state: {
    watchedAuctions: [{ name: 'NOVA', endsAt: 1_800_000_000 }],
    bids: {
      nova: {
        name: 'nova',
        amountStroops: '25000000',
        depositStroops: '25000000',
        saltHex: 'ab'.repeat(32),
        revealed: false,
      },
    },
  },
};

const passphrase = 'Passw0rd!Passw0rd!';
const iterations = 1000;

const newBid = {
  name: 'nova',
  amountStroops: '25000000',
  depositStroops: '25000000',
  saltHex: 'ab'.repeat(32),
  revealed: false,
};

describe('name auction watchlist (encrypted recovery)', () => {
  it('starts empty when there is no stored vault or legacy data', async () => {
    const { useNameWatchlistStore } = await loadStore();
    const store = useNameWatchlistStore.getState();
    store.inspectStorage();
    const state = useNameWatchlistStore.getState();
    expect(state.getStatus()).toBe('empty');
    expect(state.getBids()).toEqual({});
    expect(state.hasLegacyPlaintext).toBe(false);
    expect(state.hasEncryptedVault).toBe(false);
  });

  it('recognizes versioned plaintext watchlist data for safe encrypted migration', async () => {
    const { useNameWatchlistStore } = await loadStore();
    localStorage.setItem(
      'wraith-name-auction-watchlist',
      JSON.stringify({
        version: 1,
        type: 'wraith-versioned-value',
        data: {
          watchedAuctions: [{ name: 'nova', endsAt: 1_800_000_000 }],
          bids: { nova: newBid },
        },
      }),
    );

    useNameWatchlistStore.getState().inspectStorage();
    expect(useNameWatchlistStore.getState().status).toBe('legacy');

    await useNameWatchlistStore.getState().setPassphrase(passphrase, iterations);
    expect(useNameWatchlistStore.getState().bids.nova?.saltHex).toBe(newBid.saltHex);
    expect(localStorage.getItem('wraith-name-auction-watchlist')).toContain(
      '"type":"wraith-versioned-value"',
    );
    expect(localStorage.getItem('wraith-name-auction-watchlist.vault')).not.toContain(
      newBid.saltHex,
    );
  });

  it('restores watched auctions without decrypting bids while locked', async () => {
    const { useNameWatchlistStore: StoreA } = await loadStore();
    const storeA = StoreA.getState();
    await storeA.setPassphrase(passphrase, iterations);
    storeA.watchAuction({ name: 'nova', endsAt: 1_800_000_000 });
    storeA.lock();

    // Simulate a page reload: fresh module instance, same localStorage.
    const { useNameWatchlistStore: StoreB } = await loadStore();
    const storeB = StoreB.getState();
    storeB.inspectStorage();
    const state = StoreB.getState();
    expect(state.getStatus()).toBe('locked');
    expect(state.getBids()).toEqual({});
    expect(state.watchedAuctions).toEqual([{ name: 'nova', endsAt: 1_800_000_000 }]);
    expect(state.hasEncryptedVault).toBe(true);
  });

  it('detects existing legacy plaintext as legacy status', async () => {
    const { useNameWatchlistStore } = await loadStore();
    const store = useNameWatchlistStore.getState();
    localStorage.setItem('wraith-name-auction-watchlist', JSON.stringify(legacyPayload));
    store.inspectStorage();
    const state = useNameWatchlistStore.getState();
    expect(state.getStatus()).toBe('legacy');
    expect(state.hasLegacyPlaintext).toBe(true);
    expect(state.hasEncryptedVault).toBe(false);
  });

  it('creates an encrypted vault without writing plaintext secrets to localStorage', async () => {
    const { useNameWatchlistStore } = await loadStore();
    const store = useNameWatchlistStore.getState();
    store.inspectStorage();
    await store.setPassphrase(passphrase, iterations);
    const state = useNameWatchlistStore.getState();
    expect(state.getStatus()).toBe('unlocked');

    const raw = localStorage.getItem('wraith-name-auction-watchlist');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBe(1);
    expect(parsed.encryptedBids).toBeDefined();

    // Plaintext recovery secrets must never appear in localStorage.
    expect(raw).not.toContain(passphrase);
  });

  it('persists a new bid only in encrypted form', async () => {
    const { useNameWatchlistStore } = await loadStore();
    const store = useNameWatchlistStore.getState();
    await store.setPassphrase(passphrase, iterations);
    await store.saveBid(newBid);
    const state = useNameWatchlistStore.getState();
    expect(state.getBids().nova?.amountStroops).toBe('25000000');
    expect(state.getBids().nova?.saltHex).toBe('ab'.repeat(32));

    const raw = localStorage.getItem('wraith-name-auction-watchlist');
    expect(raw).not.toContain('25000000');
    expect(raw).not.toContain('abababab');
    const parsed = JSON.parse(raw!);
    expect(parsed.encryptedBids).toBeDefined();
  });

  it('rejects saving a bid while the vault is locked', async () => {
    const { useNameWatchlistStore } = await loadStore();
    const store = useNameWatchlistStore.getState();
    store.inspectStorage();
    await expect(store.saveBid(newBid)).rejects.toThrow(/locked/i);
  });

  it('unlocks an existing vault after a simulated reload', async () => {
    const { useNameWatchlistStore: StoreA } = await loadStore();
    const storeA = StoreA.getState();
    await storeA.setPassphrase(passphrase, iterations);
    await storeA.saveBid(newBid);

    // Simulate a page reload: fresh module instance, same localStorage.
    const { useNameWatchlistStore: StoreB } = await loadStore();
    const storeB = StoreB.getState();
    storeB.inspectStorage();
    let state = StoreB.getState();
    expect(state.getStatus()).toBe('locked');
    expect(state.getBids()).toEqual({});

    await storeB.unlock(passphrase);
    state = StoreB.getState();
    expect(state.getStatus()).toBe('unlocked');
    expect(state.getBids().nova?.amountStroops).toBe('25000000');
    expect(state.getBids().nova?.saltHex).toBe('ab'.repeat(32));
  });

  it('rejects an incorrect passphrase on unlock', async () => {
    const { useNameWatchlistStore: StoreA } = await loadStore();
    const storeA = StoreA.getState();
    await storeA.setPassphrase(passphrase, iterations);

    const { useNameWatchlistStore: StoreB } = await loadStore();
    const storeB = StoreB.getState();
    storeB.inspectStorage();
    await expect(storeB.unlock('wrong-passphrase!')).rejects.toThrow();
    const state = StoreB.getState();
    expect(state.getStatus()).toBe('error');
    expect(state.getBids()).toEqual({});
  });

  it('migrates legacy plaintext bids into an encrypted vault', async () => {
    const { useNameWatchlistStore } = await loadStore();
    const store = useNameWatchlistStore.getState();
    localStorage.setItem('wraith-name-auction-watchlist', JSON.stringify(legacyPayload));
    store.inspectStorage();
    let state = useNameWatchlistStore.getState();
    expect(state.getStatus()).toBe('legacy');

    await store.setPassphrase(passphrase, iterations);
    state = useNameWatchlistStore.getState();
    expect(state.getStatus()).toBe('unlocked');
    expect(state.getBids().nova?.amountStroops).toBe('25000000');
    expect(state.getBids().nova?.saltHex).toBe('ab'.repeat(32));

    // The encrypted replacement exists in the active record.
    expect(state.hasEncryptedVault).toBe(true);

    // Legacy plaintext remains in the canonical store until explicitly cleared.
    const raw = localStorage.getItem('wraith-name-auction-watchlist');
    expect(raw).toContain('"version":0');
    expect(raw).toContain('25000000');
  });

  it('migration keeps legacy plaintext until explicitly cleared', async () => {
    const { useNameWatchlistStore } = await loadStore();
    const store = useNameWatchlistStore.getState();
    localStorage.setItem('wraith-name-auction-watchlist', JSON.stringify(legacyPayload));
    store.inspectStorage();
    await store.setPassphrase(passphrase, iterations);

    // Legacy plaintext still present in localStorage (not yet cleared).
    const raw = localStorage.getItem('wraith-name-auction-watchlist');
    expect(raw).toContain('"version":0');

    // Clear is an explicit user action; it requires a verified encrypted replacement.
    const cleared = await store.clearLegacy();
    expect(cleared).toBe(true);

    const state = useNameWatchlistStore.getState();
    expect(state.hasLegacyPlaintext).toBe(false);

    const after = localStorage.getItem('wraith-name-auction-watchlist');
    const parsed = JSON.parse(after!);
    expect(parsed.version).toBe(1);
    expect(parsed.encryptedBids).toBeDefined();
    expect(after).not.toContain('"version":0');
    expect(after).not.toContain('25000000');
  });

  it('refuses to clear legacy plaintext without a verified encrypted replacement', async () => {
    const { useNameWatchlistStore } = await loadStore();
    const store = useNameWatchlistStore.getState();
    localStorage.setItem('wraith-name-auction-watchlist', JSON.stringify(legacyPayload));
    store.inspectStorage();

    await expect(store.clearLegacy()).rejects.toThrow(/encrypted replacement/i);
    // Original legacy data is untouched.
    const raw = localStorage.getItem('wraith-name-auction-watchlist');
    expect(raw).toBe(JSON.stringify(legacyPayload));
  });

  it('clearing legacy is idempotent and safe to repeat', async () => {
    const { useNameWatchlistStore } = await loadStore();
    const store = useNameWatchlistStore.getState();
    localStorage.setItem('wraith-name-auction-watchlist', JSON.stringify(legacyPayload));
    store.inspectStorage();
    await store.setPassphrase(passphrase, iterations);
    await store.clearLegacy();

    // Second attempt: nothing legacy left, safe no-op.
    const again = await store.clearLegacy();
    expect(again).toBe(false);
  });

  it('migration failure leaves the original plaintext intact', async () => {
    const { useNameWatchlistStore } = await loadStore();
    const store = useNameWatchlistStore.getState();
    localStorage.setItem('wraith-name-auction-watchlist', JSON.stringify(legacyPayload));
    store.inspectStorage();

    // Passphrase too short -> setup fails before touching storage.
    await expect(store.setPassphrase('short', iterations)).rejects.toThrow(/at least 8/);
    const raw = localStorage.getItem('wraith-name-auction-watchlist');
    expect(raw).toBe(JSON.stringify(legacyPayload));
  });

  it('exports a documented, versioned backup and recovers from it', async () => {
    const { useNameWatchlistStore: StoreA } = await loadStore();
    const storeA = StoreA.getState();
    await storeA.setPassphrase(passphrase, iterations);
    await storeA.saveBid(newBid);

    const backup = await storeA.exportBackup();
    const parsed = JSON.parse(backup);
    expect(parsed.type).toBe('wraith-name-auction-backup');
    expect(parsed.version).toBe(1);
    expect(parsed.vault.version).toBe(1);

    // Fresh session: import the backup and recover into an empty vault.
    const { useNameWatchlistStore: StoreB } = await loadStore();
    const storeB = StoreB.getState();
    localStorage.clear();
    await storeB.importBackup(backup, passphrase);
    const state = StoreB.getState();
    expect(state.getStatus()).toBe('unlocked');
    expect(state.getBids().nova?.amountStroops).toBe('25000000');
    expect(state.getBids().nova?.saltHex).toBe('ab'.repeat(32));
  });

  it('rejects backup import with an incorrect passphrase', async () => {
    const { useNameWatchlistStore: StoreA } = await loadStore();
    const storeA = StoreA.getState();
    await storeA.setPassphrase(passphrase, iterations);
    const backup = await storeA.exportBackup();

    const { useNameWatchlistStore: StoreB } = await loadStore();
    const storeB = StoreB.getState();
    await expect(storeB.importBackup(backup, 'wrong-passphrase!')).rejects.toThrow();
    const state = StoreB.getState();
    expect(state.getStatus()).toBe('error');
  });

  it('rejects import of a corrupted backup', async () => {
    const { useNameWatchlistStore: StoreA } = await loadStore();
    const storeA = StoreA.getState();
    await storeA.setPassphrase(passphrase, iterations);
    const backup = JSON.parse(await storeA.exportBackup());
    backup.vault.data = 'AAAA'; // corrupted
    const corrupted = JSON.stringify(backup);

    const { useNameWatchlistStore: StoreB } = await loadStore();
    const storeB = StoreB.getState();
    await expect(storeB.importBackup(corrupted, passphrase)).rejects.toThrow();
  });

  it('lock clears decrypted bids from memory', async () => {
    const { useNameWatchlistStore } = await loadStore();
    const store = useNameWatchlistStore.getState();
    await store.setPassphrase(passphrase, iterations);
    await store.saveBid(newBid);
    let state = useNameWatchlistStore.getState();
    expect(state.getBids().nova).toBeDefined();

    store.lock();
    state = useNameWatchlistStore.getState();
    expect(state.getStatus()).toBe('locked');
    expect(state.getBids()).toEqual({});
  });

  it('marks a bid revealed and persists the change encrypted', async () => {
    const { useNameWatchlistStore } = await loadStore();
    const store = useNameWatchlistStore.getState();
    await store.setPassphrase(passphrase, iterations);
    await store.saveBid(newBid);
    expect(useNameWatchlistStore.getState().getBids().nova?.revealed).toBe(false);

    await store.markBidRevealed('nova');
    expect(useNameWatchlistStore.getState().getBids().nova?.revealed).toBe(true);
    const raw = localStorage.getItem('wraith-name-auction-watchlist');
    expect(raw).not.toContain('25000000');
  });

  it('removes a bid and persists the change encrypted', async () => {
    const { useNameWatchlistStore } = await loadStore();
    const store = useNameWatchlistStore.getState();
    await store.setPassphrase(passphrase, iterations);
    await store.saveBid(newBid);
    await store.removeBid('nova');
    expect(useNameWatchlistStore.getState().getBids().nova).toBeUndefined();
  });

  it('watch and unwatch track auctions without exposing bid secrets', async () => {
    const { useNameWatchlistStore } = await loadStore();
    const store = useNameWatchlistStore.getState();
    store.inspectStorage();
    await store.setPassphrase(passphrase, iterations);

    store.watchAuction({ name: 'nova', endsAt: 1_800_000_000 });
    expect(useNameWatchlistStore.getState().getBids()).toEqual({});
    const raw = localStorage.getItem('wraith-name-auction-watchlist');
    expect(raw).not.toContain('25000000');

    store.unwatchAuction('nova');
  });
});

describe('import backup safety (no silent vault destruction)', () => {
  const currentBid = {
    name: 'alpha',
    amountStroops: '10000000',
    depositStroops: '10000000',
    saltHex: 'cd'.repeat(32),
    revealed: false,
  };
  const importedBid = {
    name: 'beta',
    amountStroops: '20000000',
    depositStroops: '20000000',
    saltHex: 'ef'.repeat(32),
    revealed: false,
  };

  async function exportImportedBackup(): Promise<string> {
    const { useNameWatchlistStore: StoreC } = await loadStore();
    const storeC = StoreC.getState();
    await storeC.setPassphrase(passphrase, iterations);
    await storeC.saveBid(importedBid);
    return await storeC.exportBackup();
  }

  async function establishCurrentVault(): Promise<void> {
    // Start from a clean slate: the exported backup may have left a vault in
    // shared localStorage, which setPassphrase would otherwise reject.
    localStorage.clear();
    const { useNameWatchlistStore: StoreA } = await loadStore();
    const storeA = StoreA.getState();
    await storeA.setPassphrase(passphrase, iterations);
    await storeA.saveBid(currentBid);
  }

  it('refuses to replace a non-empty current vault without explicit confirmation', async () => {
    const backup = await exportImportedBackup();
    await establishCurrentVault();

    // Fresh session (simulated reload): current vault still holds currentBid.
    const { useNameWatchlistStore: StoreB } = await loadStore();
    const storeB = StoreB.getState();
    storeB.inspectStorage();
    expect(storeB.getStatus()).toBe('locked');

    await expect(storeB.importBackup(backup, passphrase)).rejects.toThrow(
      /current vault|replacement/i,
    );

    // Current vault untouched: currentBid still recoverable after unlock.
    await storeB.unlock(passphrase);
    expect(storeB.getBids().alpha?.saltHex).toBe(currentBid.saltHex);
    expect(storeB.getBids().beta).toBeUndefined();
  });

  it('replaces the current vault only when replacement is explicitly confirmed', async () => {
    const backup = await exportImportedBackup();
    await establishCurrentVault();

    const { useNameWatchlistStore: StoreA } = await loadStore();
    const storeA = StoreA.getState();
    storeA.inspectStorage();
    expect(storeA.getStatus()).toBe('locked');

    await storeA.importBackup(backup, passphrase, { replace: true });
    const state = StoreA.getState();
    expect(state.getStatus()).toBe('unlocked');
    expect(state.getBids().beta?.saltHex).toBe(importedBid.saltHex);
    expect(state.getBids().alpha).toBeUndefined();

    // The replacement is durable across a simulated reload.
    const { useNameWatchlistStore: StoreB } = await loadStore();
    const storeB = StoreB.getState();
    storeB.inspectStorage();
    await storeB.unlock(passphrase);
    expect(storeB.getBids().beta?.amountStroops).toBe('20000000');
    expect(storeB.getBids().alpha).toBeUndefined();
  });

  it('preserves the current vault when import uses the wrong passphrase', async () => {
    const backup = await exportImportedBackup();
    await establishCurrentVault();

    const { useNameWatchlistStore: StoreA } = await loadStore();
    const storeA = StoreA.getState();
    storeA.inspectStorage();

    await expect(
      storeA.importBackup(backup, 'wrong-passphrase!', { replace: true }),
    ).rejects.toThrow();
    // Current vault preserved: unlock with the original passphrase still recovers currentBid.
    await storeA.unlock(passphrase);
    expect(storeA.getBids().alpha?.saltHex).toBe(currentBid.saltHex);
    expect(storeA.getBids().beta).toBeUndefined();
  });

  it('preserves the current vault when importing a corrupted backup', async () => {
    const parsed = JSON.parse(await exportImportedBackup());
    parsed.vault.data = 'AAAA'; // corrupted ciphertext
    const corrupted = JSON.stringify(parsed);
    await establishCurrentVault();

    const { useNameWatchlistStore: StoreA } = await loadStore();
    const storeA = StoreA.getState();
    storeA.inspectStorage();

    await expect(storeA.importBackup(corrupted, passphrase, { replace: true })).rejects.toThrow();
    // Current vault preserved.
    await storeA.unlock(passphrase);
    expect(storeA.getBids().alpha?.saltHex).toBe(currentBid.saltHex);
    expect(storeA.getBids().beta).toBeUndefined();
  });
});

describe('saveBid read-back verification (submission gate)', () => {
  const gateBid = {
    name: 'gate',
    amountStroops: '7000000',
    depositStroops: '7000000',
    saltHex: '01'.repeat(32),
    revealed: false,
  };

  it('persists a decryptable, verified recovery record before it can be trusted for submission', async () => {
    const { useNameWatchlistStore } = await loadStore();
    const store = useNameWatchlistStore.getState();
    await store.setPassphrase(passphrase, iterations);
    await store.saveBid(gateBid);

    // The persisted vault must be decryptable and contain the exact recovery
    // material (salt + amount) — this is the verification gate that must pass
    // before an on-chain commit is ever submitted.
    const raw = localStorage.getItem('wraith-name-auction-watchlist');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.encryptedBids).toBeDefined();
    // Plaintext recovery secrets must never appear in localStorage.
    expect(raw).not.toContain(gateBid.saltHex);
    expect(raw).not.toContain(gateBid.amountStroops);

    const decrypted = await decryptBids(passphrase, parsed.encryptedBids);
    expect(decrypted.gate?.saltHex).toBe(gateBid.saltHex);
    expect(decrypted.gate?.amountStroops).toBe(gateBid.amountStroops);
    expect(decrypted.gate?.revealed).toBe(false);
  });

  it('persists submission status transitions with the encrypted recovery secret', async () => {
    const { useNameWatchlistStore: StoreA } = await loadStore();
    const storeA = StoreA.getState();
    await storeA.setPassphrase(passphrase, iterations);
    await storeA.saveBid({ ...gateBid, submissionStatus: 'pending' });
    await storeA.updateBidSubmission('gate', 'committed', 'stellar-hash');

    expect(StoreA.getState().getBids().gate).toMatchObject({
      saltHex: gateBid.saltHex,
      submissionStatus: 'committed',
      transactionHash: 'stellar-hash',
    });
    const raw = localStorage.getItem('wraith-name-auction-watchlist');
    expect(raw).not.toContain(gateBid.saltHex);

    const { useNameWatchlistStore: StoreB } = await loadStore();
    const storeB = StoreB.getState();
    storeB.inspectStorage();
    await storeB.unlock(passphrase);
    expect(storeB.getBids().gate).toMatchObject({
      saltHex: gateBid.saltHex,
      submissionStatus: 'committed',
      transactionHash: 'stellar-hash',
    });
    await storeB.updateBidSubmission('gate', 'unknown', 'possible-hash');
    expect(storeB.getBids().gate).toMatchObject({
      saltHex: gateBid.saltHex,
      submissionStatus: 'unknown',
      transactionHash: 'possible-hash',
    });
  });
});
