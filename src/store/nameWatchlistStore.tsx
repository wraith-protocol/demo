import { create } from 'zustand';
import {
  AUCTION_STORAGE_KEY,
  DEFAULT_PBKDF2_ITERATIONS,
  MAX_AUCTION_BIDS,
  VAULT_STORAGE_KEY,
  createBackup,
  decryptBids,
  decryptBidsWithKey,
  deriveVaultKey,
  encryptBids,
  encryptBidsWithKey,
  isAuctionBid,
  isValidVault,
  parseBackup,
  validateBids,
  type AuctionBid,
  type EncryptedBidVault,
} from '@/lib/auctionEncryption';

const MAX_WATCHED_AUCTIONS = 500;
const MAX_STORAGE_BYTES = 400_000;
const STORAGE_VERSION = 1;

export interface WatchedNameAuction {
  name: string;
  endsAt: number;
}

export type AuctionStatus = 'empty' | 'legacy' | 'locked' | 'unlocked' | 'error';

interface ActiveRecord {
  watchedAuctions: WatchedNameAuction[];
  encryptedBids: EncryptedBidVault | null;
}

interface NameWatchlistState {
  watchedAuctions: WatchedNameAuction[];
  bids: Record<string, AuctionBid>;
  status: AuctionStatus;
  error: string | null;
  hasLegacyPlaintext: boolean;
  hasEncryptedVault: boolean;
  inspectStorage: () => void;
  setPassphrase: (passphrase: string, iterations?: number) => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  lock: () => void;
  watchAuction: (auction: WatchedNameAuction) => Promise<void>;
  unwatchAuction: (name: string) => Promise<void>;
  saveBid: (bid: AuctionBid) => Promise<void>;
  markBidRevealed: (name: string) => Promise<void>;
  removeBid: (name: string) => Promise<void>;
  exportBackup: () => Promise<string>;
  importBackup: (
    backup: string,
    passphrase: string,
    options?: { replace?: boolean },
  ) => Promise<void>;
  clearLegacy: () => Promise<boolean>;
  getBids: () => Record<string, AuctionBid>;
  getStatus: () => AuctionStatus;
}

interface Snapshot {
  watchedAuctions: WatchedNameAuction[];
  activeRecord: ActiveRecord;
  vault: EncryptedBidVault | null;
  legacyBids: Record<string, AuctionBid> | null;
  hasLegacyPlaintext: boolean;
  hasEncryptedVault: boolean;
  status: AuctionStatus;
  destination: string;
}

const normalizeName = (name: string) => name.trim().toLowerCase();

let activeKey: CryptoKey | null = null;
let activeMetadata: { salt: string; iterations: number } | null = null;
let activeVaultFingerprint: string | null = null;
let activeKeyGeneration = 0;
let persistenceQueue: Promise<void> = Promise.resolve();

function clearActiveKey() {
  activeKeyGeneration += 1;
  activeKey = null;
  activeMetadata = null;
  activeVaultFingerprint = null;
}

function serializePersistence<T>(operation: () => Promise<T>): Promise<T> {
  const result = persistenceQueue.then(operation, operation);
  persistenceQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function storageOrNull(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch (error) {
    throw new Error(
      `Auction recovery storage is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readRaw(key: string): { raw: string; value: unknown } | null {
  const storage = storageOrNull();
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch (error) {
    throw new Error(
      `Unable to read auction recovery storage: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (raw === null) return null;
  if (raw.length > MAX_STORAGE_BYTES) {
    throw new Error(`Auction recovery storage entry "${key}" exceeds the supported size.`);
  }
  try {
    return { raw, value: JSON.parse(raw) as unknown };
  } catch {
    throw new Error(`Auction recovery storage entry "${key}" is not valid JSON.`);
  }
}

function normalizeWatchedAuctions(value: unknown): WatchedNameAuction[] {
  if (!Array.isArray(value) || value.length > MAX_WATCHED_AUCTIONS) {
    throw new Error('Stored auction watchlist is malformed.');
  }
  return value.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error('Stored auction watchlist contains a malformed entry.');
    }
    const entry = item as Record<string, unknown>;
    if (
      typeof entry.name !== 'string' ||
      entry.name.trim().length === 0 ||
      entry.name.length > 128 ||
      typeof entry.endsAt !== 'number' ||
      !Number.isFinite(entry.endsAt) ||
      entry.endsAt < 0
    ) {
      throw new Error('Stored auction watchlist contains a malformed entry.');
    }
    return { name: normalizeName(entry.name), endsAt: entry.endsAt };
  });
}

function unwrapVersioned(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (
    typeof record.version === 'number' &&
    record.version !== 0 &&
    record.version !== STORAGE_VERSION
  ) {
    throw new Error(`Unsupported auction watchlist storage version: ${record.version}.`);
  }
  if (record.version === STORAGE_VERSION && 'data' in record) return record.data;
  if ('state' in record && record.state && typeof record.state === 'object') return record.state;
  return value;
}

function parseActiveRecord(value: unknown): ActiveRecord | null {
  const unwrapped = unwrapVersioned(value);
  if (!unwrapped || typeof unwrapped !== 'object' || Array.isArray(unwrapped)) return null;
  const record = unwrapped as Record<string, unknown>;
  if (!('encryptedBids' in record)) return null;
  const watchedAuctions = normalizeWatchedAuctions(record.watchedAuctions ?? []);
  const encryptedBids =
    record.encryptedBids === null
      ? null
      : isValidVault(record.encryptedBids)
        ? record.encryptedBids
        : (() => {
            throw new Error('Stored auction recovery vault is malformed or unsupported.');
          })();
  return { watchedAuctions, encryptedBids };
}

function parseVaultEntry(value: unknown): ActiveRecord {
  if (isValidVault(value)) return { watchedAuctions: [], encryptedBids: value };
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).type === 'wraith-name-auction-backup'
  ) {
    const backup = parseBackup(value);
    return { watchedAuctions: [], encryptedBids: backup.vault };
  }
  const active = parseActiveRecord(value);
  if (active) return active;
  throw new Error('Staged auction recovery vault is malformed.');
}

function parseLegacy(
  value: unknown,
): { watchedAuctions: WatchedNameAuction[]; bids: Record<string, AuctionBid> } | null {
  const unwrapped = unwrapVersioned(value);
  if (!unwrapped || typeof unwrapped !== 'object' || Array.isArray(unwrapped)) return null;
  const record = unwrapped as Record<string, unknown>;
  if (!('bids' in record)) return null;
  const watchedAuctions = normalizeWatchedAuctions(record.watchedAuctions ?? []);
  validateBids(record.bids);
  if (Object.keys(record.bids).length > MAX_AUCTION_BIDS) {
    throw new Error('Legacy recovery data contains too many bids.');
  }
  return {
    watchedAuctions,
    bids: record.bids as Record<string, AuctionBid>,
  };
}

function readSnapshot(): Snapshot {
  const canonicalEntry = readRaw(AUCTION_STORAGE_KEY);
  const stagedEntry = readRaw(VAULT_STORAGE_KEY);
  const canonicalRecord = canonicalEntry ? parseActiveRecord(canonicalEntry.value) : null;
  const legacy = canonicalEntry ? parseLegacy(canonicalEntry.value) : null;
  const canonicalWatchlist = canonicalRecord?.watchedAuctions ?? legacy?.watchedAuctions ?? [];
  const stagedRecord = stagedEntry ? parseVaultEntry(stagedEntry.value) : null;

  const activeRecord = stagedRecord?.encryptedBids
    ? stagedRecord
    : canonicalRecord?.encryptedBids
      ? canonicalRecord
      : (stagedRecord ??
        canonicalRecord ?? { watchedAuctions: canonicalWatchlist, encryptedBids: null });
  const watchedAuctions =
    activeRecord.watchedAuctions.length > 0 || !legacy
      ? activeRecord.watchedAuctions
      : legacy.watchedAuctions;
  const hasLegacyPlaintext = Boolean(legacy && Object.keys(legacy.bids).length > 0);
  const vault = activeRecord.encryptedBids;
  const destination = hasLegacyPlaintext || stagedEntry ? VAULT_STORAGE_KEY : AUCTION_STORAGE_KEY;

  return {
    watchedAuctions,
    activeRecord: { ...activeRecord, watchedAuctions },
    vault,
    legacyBids: hasLegacyPlaintext ? legacy!.bids : null,
    hasLegacyPlaintext,
    hasEncryptedVault: vault !== null,
    status: hasLegacyPlaintext ? (vault ? 'locked' : 'legacy') : vault ? 'locked' : 'empty',
    destination,
  };
}

function emptySnapshot(): Snapshot {
  return {
    watchedAuctions: [],
    activeRecord: { watchedAuctions: [], encryptedBids: null },
    vault: null,
    legacyBids: null,
    hasLegacyPlaintext: false,
    hasEncryptedVault: false,
    status: 'empty',
    destination: AUCTION_STORAGE_KEY,
  };
}

function snapshotForInitialState(): Snapshot {
  try {
    return readSnapshot();
  } catch {
    return { ...emptySnapshot(), status: 'error' };
  }
}

function toPersistedValue(record: ActiveRecord): string {
  return JSON.stringify({
    version: STORAGE_VERSION,
    type: 'wraith-versioned-value',
    data: record,
  });
}

function equalBids(left: Record<string, AuctionBid>, right: Record<string, AuctionBid>): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && JSON.stringify(left[key]) === JSON.stringify(right[key]),
    )
  );
}

function writeAndVerify(record: ActiveRecord, key: string): void {
  if (record.encryptedBids && !isValidVault(record.encryptedBids)) {
    throw new Error('Refusing to persist an invalid auction recovery vault.');
  }
  const storage = storageOrNull();
  if (!storage) throw new Error('Auction recovery storage is unavailable.');
  const serialized = toPersistedValue(record);
  const previous = storage.getItem(key);
  let wrote = false;
  try {
    storage.setItem(key, serialized);
    wrote = true;
    const readBack = storage.getItem(key);
    if (readBack !== serialized) {
      throw new Error('Auction recovery record did not match after storage read-back.');
    }
    const parsed = JSON.parse(readBack) as { data?: unknown };
    const readBackRecord = parseActiveRecord(parsed);
    if (!readBackRecord || JSON.stringify(readBackRecord) !== JSON.stringify(record)) {
      throw new Error('Auction recovery record failed storage verification.');
    }
  } catch (error) {
    if (wrote) {
      try {
        if (previous === null) storage.removeItem(key);
        else storage.setItem(key, previous);
        if (storage.getItem(key) !== previous) {
          throw new Error('Previous auction recovery data could not be restored.');
        }
      } catch (restoreError) {
        throw new Error(
          `Auction recovery persistence failed and rollback could not be verified: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
        );
      }
    }
    throw error;
  }
}

function toStoreState(
  snapshot: Snapshot,
): Pick<
  NameWatchlistState,
  'watchedAuctions' | 'bids' | 'status' | 'error' | 'hasLegacyPlaintext' | 'hasEncryptedVault'
> {
  return {
    watchedAuctions: snapshot.watchedAuctions,
    bids: {},
    status: snapshot.status,
    error: null,
    hasLegacyPlaintext: snapshot.hasLegacyPlaintext,
    hasEncryptedVault: snapshot.hasEncryptedVault,
  };
}

const initialSnapshot = snapshotForInitialState();

export const useNameWatchlistStore = create<NameWatchlistState>((set, get) => ({
  ...toStoreState(initialSnapshot),

  inspectStorage() {
    try {
      const snapshot = readSnapshot();
      const wasUnlocked =
        get().status === 'unlocked' &&
        activeKey !== null &&
        activeVaultFingerprint === JSON.stringify(snapshot.vault);
      if (!wasUnlocked) clearActiveKey();
      set({
        ...toStoreState(snapshot),
        ...(wasUnlocked ? { bids: get().bids, status: 'unlocked' as const } : {}),
      });
    } catch (error) {
      clearActiveKey();
      set({
        ...toStoreState(emptySnapshot()),
        status: 'error',
        error:
          error instanceof Error ? error.message : 'Unable to inspect auction recovery storage.',
      });
    }
  },

  async setPassphrase(passphrase, iterations = DEFAULT_PBKDF2_ITERATIONS) {
    await serializePersistence(async () => {
      if (passphrase.length < 8) throw new Error('Passphrase must be at least 8 characters.');
      const generation = activeKeyGeneration;
      const snapshot = readSnapshot();
      if (snapshot.vault) throw new Error('An encrypted vault already exists. Unlock it instead.');
      const bids = snapshot.legacyBids ?? {};
      const vault = await encryptBids(passphrase, bids, iterations);
      const key = await deriveVaultKey(passphrase, vault);
      const verifiedBids = await decryptBidsWithKey(key, vault);
      if (!equalBids(verifiedBids, bids)) {
        throw new Error('Encrypted recovery record failed pre-persistence verification.');
      }
      if (generation !== activeKeyGeneration) {
        throw new Error('Vault state changed before recovery data could be encrypted.');
      }
      const record = {
        ...snapshot.activeRecord,
        watchedAuctions: snapshot.watchedAuctions,
        encryptedBids: vault,
      };
      await writeAndVerifyAsync(record, snapshot.destination, bids, key);
      if (generation !== activeKeyGeneration) {
        throw new Error('Vault was locked before encrypted recovery could be activated.');
      }
      activeKey = key;
      activeMetadata = { salt: vault.kdf.salt, iterations: vault.kdf.iterations };
      activeVaultFingerprint = JSON.stringify(vault);
      set({
        watchedAuctions: snapshot.watchedAuctions,
        bids,
        status: 'unlocked',
        error: null,
        hasLegacyPlaintext: snapshot.hasLegacyPlaintext,
        hasEncryptedVault: true,
      });
    });
  },

  async unlock(passphrase) {
    clearActiveKey();
    set({ bids: {}, status: 'locked', error: null });
    const generation = activeKeyGeneration;
    try {
      const snapshot = readSnapshot();
      if (!snapshot.vault) throw new Error('No encrypted auction recovery vault exists.');
      const key = await deriveVaultKey(passphrase, snapshot.vault);
      const bids = await decryptBidsWithKey(key, snapshot.vault);
      if (generation !== activeKeyGeneration) {
        throw new Error('Vault state changed while it was being unlocked.');
      }
      activeKey = key;
      activeMetadata = {
        salt: snapshot.vault.kdf.salt,
        iterations: snapshot.vault.kdf.iterations,
      };
      activeVaultFingerprint = JSON.stringify(snapshot.vault);
      set({
        watchedAuctions: snapshot.watchedAuctions,
        bids,
        status: 'unlocked',
        error: null,
        hasLegacyPlaintext: snapshot.hasLegacyPlaintext,
        hasEncryptedVault: true,
      });
    } catch (error) {
      if (generation === activeKeyGeneration) {
        clearActiveKey();
        const snapshot = snapshotForInitialState();
        set({
          watchedAuctions: snapshot.watchedAuctions,
          bids: {},
          status: 'error',
          error:
            error instanceof Error ? error.message : 'Unable to unlock auction recovery vault.',
          hasLegacyPlaintext: snapshot.hasLegacyPlaintext,
          hasEncryptedVault: snapshot.hasEncryptedVault,
        });
      }
      throw error;
    }
  },

  lock() {
    clearActiveKey();
    const snapshot = snapshotForInitialState();
    set({ ...toStoreState(snapshot), bids: {} });
  },

  watchAuction(auction) {
    const name = normalizeName(auction.name);
    set((state) => ({
      watchedAuctions: [
        ...state.watchedAuctions.filter((entry) => entry.name !== name),
        { name, endsAt: auction.endsAt },
      ],
    }));
    return serializePersistence(async () => {
      const snapshot = readSnapshot();
      const watchedAuctions = [
        ...snapshot.watchedAuctions.filter((entry) => entry.name !== name),
        { name, endsAt: auction.endsAt },
      ];
      writeAndVerify({ ...snapshot.activeRecord, watchedAuctions }, snapshot.destination);
      set({ watchedAuctions });
    }).catch((error) => {
      get().inspectStorage();
      throw error;
    });
  },

  unwatchAuction(name) {
    const normalized = normalizeName(name);
    set((state) => ({
      watchedAuctions: state.watchedAuctions.filter((entry) => entry.name !== normalized),
    }));
    return serializePersistence(async () => {
      const snapshot = readSnapshot();
      const watchedAuctions = snapshot.watchedAuctions.filter((entry) => entry.name !== normalized);
      writeAndVerify({ ...snapshot.activeRecord, watchedAuctions }, snapshot.destination);
      set({ watchedAuctions });
    }).catch((error) => {
      get().inspectStorage();
      throw error;
    });
  },

  async saveBid(bid) {
    await serializePersistence(async () => {
      if (get().status !== 'unlocked' || !activeKey || !activeMetadata) {
        throw new Error('Unlock the recovery vault before saving a bid.');
      }
      const key = activeKey;
      const generation = activeKeyGeneration;
      const metadata = activeMetadata;
      const normalizedBid = { ...bid, name: normalizeName(bid.name) };
      if (!isAuctionBid(normalizedBid)) {
        throw new Error('Bid recovery record is malformed.');
      }
      const snapshot = readSnapshot();
      const bids = { ...get().bids, [normalizedBid.name]: normalizedBid };
      validateBids(bids);
      const vault = await encryptBidsWithKey(key, metadata, bids);
      if (generation !== activeKeyGeneration || activeKey !== key) {
        throw new Error('Vault was locked before the recovery record could be persisted.');
      }
      const watchedAuctions = snapshot.watchedAuctions.some(
        (entry) => entry.name === normalizedBid.name,
      )
        ? snapshot.watchedAuctions
        : [...snapshot.watchedAuctions, { name: normalizedBid.name, endsAt: 0 }];
      const record = { watchedAuctions, encryptedBids: vault };
      await writeAndVerifyAsync(record, snapshot.destination, bids, key);
      if (generation !== activeKeyGeneration || activeKey !== key) {
        throw new Error('Vault was locked before the recovery record was activated.');
      }
      activeMetadata = { salt: vault.kdf.salt, iterations: vault.kdf.iterations };
      activeVaultFingerprint = JSON.stringify(vault);
      set({ bids, watchedAuctions, hasEncryptedVault: true });
    });
  },

  async markBidRevealed(name) {
    await serializePersistence(async () => {
      if (get().status !== 'unlocked' || !activeKey || !activeMetadata) {
        throw new Error('Unlock the recovery vault before updating a bid.');
      }
      const key = activeKey;
      const generation = activeKeyGeneration;
      const metadata = activeMetadata;
      const keyName = normalizeName(name);
      const existing = get().bids[keyName];
      if (!existing) return;
      const bids = { ...get().bids, [keyName]: { ...existing, revealed: true } };
      const snapshot = readSnapshot();
      const vault = await encryptBidsWithKey(key, metadata, bids);
      if (generation !== activeKeyGeneration || activeKey !== key) {
        throw new Error('Vault was locked before the recovery record could be persisted.');
      }
      const record = { ...snapshot.activeRecord, encryptedBids: vault };
      await writeAndVerifyAsync(record, snapshot.destination, bids, key);
      if (generation !== activeKeyGeneration || activeKey !== key) {
        throw new Error('Vault was locked before the recovery record was activated.');
      }
      activeMetadata = { salt: vault.kdf.salt, iterations: vault.kdf.iterations };
      activeVaultFingerprint = JSON.stringify(vault);
      set({ bids, hasEncryptedVault: true });
    });
  },

  async removeBid(name) {
    await serializePersistence(async () => {
      if (get().status !== 'unlocked' || !activeKey || !activeMetadata) {
        throw new Error('Unlock the recovery vault before removing a bid.');
      }
      const key = activeKey;
      const generation = activeKeyGeneration;
      const metadata = activeMetadata;
      const keyName = normalizeName(name);
      const bids = { ...get().bids };
      delete bids[keyName];
      const snapshot = readSnapshot();
      const vault = await encryptBidsWithKey(key, metadata, bids);
      if (generation !== activeKeyGeneration || activeKey !== key) {
        throw new Error('Vault was locked before the recovery record could be persisted.');
      }
      const record = { ...snapshot.activeRecord, encryptedBids: vault };
      await writeAndVerifyAsync(record, snapshot.destination, bids, key);
      if (generation !== activeKeyGeneration || activeKey !== key) {
        throw new Error('Vault was locked before the recovery record was activated.');
      }
      activeMetadata = { salt: vault.kdf.salt, iterations: vault.kdf.iterations };
      activeVaultFingerprint = JSON.stringify(vault);
      set({ bids, hasEncryptedVault: true });
    });
  },

  async exportBackup() {
    const snapshot = readSnapshot();
    if (!snapshot.vault) throw new Error('No encrypted recovery vault is available to back up.');
    return JSON.stringify(createBackup(snapshot.vault), null, 2);
  },

  async importBackup(backup, passphrase, { replace = false } = {}) {
    await serializePersistence(async () => {
      if (passphrase.length < 8) throw new Error('Passphrase must be at least 8 characters.');
      const generation = activeKeyGeneration;
      const snapshot = readSnapshot();
      if (snapshot.vault && !replace) {
        throw new Error(
          'An encrypted recovery vault exists. Confirm replacement before importing.',
        );
      }
      try {
        const parsed = parseBackup(JSON.parse(backup) as unknown);
        const key = await deriveVaultKey(passphrase, parsed.vault);
        const bids = await decryptBidsWithKey(key, parsed.vault);
        if (generation !== activeKeyGeneration) {
          throw new Error('Vault state changed before the backup could be imported.');
        }
        const record = {
          ...snapshot.activeRecord,
          watchedAuctions: snapshot.watchedAuctions,
          encryptedBids: parsed.vault,
        };
        await writeAndVerifyAsync(record, snapshot.destination, bids, key);
        if (generation !== activeKeyGeneration) {
          throw new Error('Vault was locked before the imported backup could be activated.');
        }
        activeKey = key;
        activeMetadata = {
          salt: parsed.vault.kdf.salt,
          iterations: parsed.vault.kdf.iterations,
        };
        activeVaultFingerprint = JSON.stringify(parsed.vault);
        set({
          watchedAuctions: snapshot.watchedAuctions,
          bids,
          status: 'unlocked',
          error: null,
          hasLegacyPlaintext: snapshot.hasLegacyPlaintext,
          hasEncryptedVault: true,
        });
      } catch (error) {
        set({ error: error instanceof Error ? error.message : 'Unable to import auction backup.' });
        throw error;
      }
    });
  },

  async clearLegacy() {
    return serializePersistence(async () => {
      const snapshot = readSnapshot();
      if (!snapshot.hasLegacyPlaintext) return false;
      if (!snapshot.vault || !activeKey || get().status !== 'unlocked') {
        throw new Error(
          'Unlock and verify the encrypted vault before deleting legacy bid secrets.',
        );
      }
      const key = activeKey;
      const generation = activeKeyGeneration;
      const verified = await decryptBidsWithKey(key, snapshot.vault);
      if (generation !== activeKeyGeneration || activeKey !== key) {
        throw new Error('Vault was locked before legacy recovery data could be removed.');
      }
      if (!equalBids(verified, get().bids)) {
        throw new Error('Encrypted recovery record does not match the unlocked bids.');
      }
      const storage = storageOrNull();
      if (!storage) throw new Error('Auction recovery storage is unavailable.');
      storage.removeItem(AUCTION_STORAGE_KEY);
      if (storage.getItem(AUCTION_STORAGE_KEY) !== null) {
        throw new Error('Legacy plaintext recovery data could not be removed.');
      }
      const next = readSnapshot();
      set({
        watchedAuctions: next.watchedAuctions,
        bids: get().bids,
        status: 'unlocked',
        error: null,
        hasLegacyPlaintext: false,
        hasEncryptedVault: true,
      });
      return true;
    });
    return true;
  },

  getBids() {
    return get().bids;
  },

  getStatus() {
    return get().status;
  },
}));

async function writeAndVerifyAsync(
  record: ActiveRecord,
  key: string,
  expectedBids: Record<string, AuctionBid>,
  verificationKey: CryptoKey,
): Promise<void> {
  if (record.encryptedBids && !isValidVault(record.encryptedBids)) {
    throw new Error('Refusing to persist an invalid auction recovery vault.');
  }
  const storage = storageOrNull();
  if (!storage) throw new Error('Auction recovery storage is unavailable.');
  const serialized = toPersistedValue(record);
  const previous = storage.getItem(key);
  let wrote = false;
  try {
    storage.setItem(key, serialized);
    wrote = true;
    const readBack = storage.getItem(key);
    if (readBack !== serialized) {
      throw new Error('Auction recovery record did not match after storage read-back.');
    }
    const parsed = JSON.parse(readBack) as { data?: unknown };
    const readBackRecord = parseActiveRecord(parsed);
    if (!readBackRecord || JSON.stringify(readBackRecord) !== JSON.stringify(record)) {
      throw new Error('Auction recovery record failed storage verification.');
    }
    if (!readBackRecord.encryptedBids) {
      throw new Error('Encrypted recovery record is unavailable for verification.');
    }
    const decrypted = await decryptBidsWithKey(verificationKey, readBackRecord.encryptedBids);
    if (!equalBids(decrypted, expectedBids)) {
      throw new Error('Persisted recovery record does not match the expected bid secrets.');
    }
  } catch (error) {
    if (wrote) {
      try {
        if (previous === null) storage.removeItem(key);
        else storage.setItem(key, previous);
        if (storage.getItem(key) !== previous) {
          throw new Error('Previous auction recovery data could not be restored.');
        }
      } catch (restoreError) {
        throw new Error(
          `Auction recovery persistence failed and rollback could not be verified: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
        );
      }
    }
    throw error;
  }
}

function refreshFromExternalStorage() {
  clearActiveKey();
  try {
    const snapshot = readSnapshot();
    useNameWatchlistStore.setState({ ...toStoreState(snapshot), bids: {} });
  } catch (error) {
    useNameWatchlistStore.setState({
      ...toStoreState(emptySnapshot()),
      status: 'error',
      error:
        error instanceof Error ? error.message : 'Unable to synchronize auction recovery storage.',
    });
  }
}

let storageListener: ((event: StorageEvent) => void) | null = null;

export function initNameWatchlistSync() {
  if (typeof window === 'undefined' || storageListener !== null) return;
  if (typeof window.addEventListener !== 'function') return;

  storageListener = (event: StorageEvent) => {
    if (
      event.key === AUCTION_STORAGE_KEY ||
      event.key === VAULT_STORAGE_KEY ||
      event.key === null
    ) {
      refreshFromExternalStorage();
    }
  };
  window.addEventListener('storage', storageListener);
  useNameWatchlistStore.getState().inspectStorage();
}

export function cleanupNameWatchlistSync() {
  if (storageListener === null) return;
  if (typeof window.removeEventListener !== 'function') {
    storageListener = null;
    return;
  }
  window.removeEventListener('storage', storageListener);
  storageListener = null;
}
