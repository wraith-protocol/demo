import { create } from 'zustand';

import type { AuctionBid } from '@/lib/auctionEncryption';
import {
  AUCTION_STORAGE_KEY,
  AUCTION_VAULT_VERSION,
  DEFAULT_PBKDF2_ITERATIONS,
  createBackup,
  decryptBids,
  deriveKey,
  encryptBids,
  isValidVault,
  parseBackup,
  type EncryptedBidVault,
} from '@/lib/auctionEncryption';

/**
 * Staging/active storage key for the encrypted bid recovery vault while legacy
 * plaintext has not yet been explicitly cleared. While legacy plaintext is
 * present, the canonical key (`wraith-name-auction-watchlist`) holds the
 * legacy v0 payload untouched and the active record (watched auctions +
 * encrypted bids) is staged under this vault key. Once the user explicitly
 * clears the legacy plaintext, the active record is written to the canonical
 * key and this vault key is removed.
 */
export const VAULT_STORAGE_KEY = `${AUCTION_STORAGE_KEY}.vault`;

export type { AuctionBid };

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
  watchAuction: (auction: WatchedNameAuction) => void;
  unwatchAuction: (name: string) => void;
  saveBid: (bid: AuctionBid) => Promise<void>;
  updateBidSubmission: (
    name: string,
    submissionStatus: NonNullable<AuctionBid['submissionStatus']>,
    transactionHash?: string,
  ) => Promise<void>;
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

const normalizeName = (name: string) => name.trim().toLowerCase();

/**
 * In-memory derived encryption key, held only while the vault is unlocked.
 * Cleared on lock, page reload, or logout. Never persisted to localStorage.
 */
let activeKey: CryptoKey | null = null;
let activeKdfMeta: { salt: string; iterations: number } | null = null;

function clearActiveKey() {
  activeKey = null;
  activeKdfMeta = null;
}

function readRaw<T = unknown>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function removeRaw(key: string): void {
  localStorage.removeItem(key);
}

/** Legacy zustand-persist format: { version: 0, state: { watchedAuctions, bids } } */
function readLegacy(): {
  bids: Record<string, AuctionBid>;
  watchedAuctions: WatchedNameAuction[];
} | null {
  const raw = readRaw<Record<string, unknown>>(AUCTION_STORAGE_KEY);
  if (!raw) return null;
  const legacyState =
    raw.version === 0 && raw.state && typeof raw.state === 'object'
      ? (raw.state as Record<string, unknown>)
      : raw.version === AUCTION_VAULT_VERSION && raw.data && typeof raw.data === 'object'
        ? (raw.data as Record<string, unknown>)
        : null;
  if (!legacyState) return null;
  const watchedAuctions = Array.isArray(legacyState.watchedAuctions)
    ? legacyState.watchedAuctions
    : [];
  const bids = legacyState.bids;
  if (!bids || typeof bids !== 'object' || Array.isArray(bids)) {
    return { bids: {}, watchedAuctions };
  }
  return { bids: bids as Record<string, AuctionBid>, watchedAuctions };
}

/** New v1 format: { version: 1, watchedAuctions, encryptedBids: EncryptedBidVault | null } */
function readCanonicalV1(): ActiveRecord | null {
  const raw = readRaw<{
    version: number;
    data?: unknown;
    watchedAuctions?: unknown;
    encryptedBids?: unknown;
  }>(AUCTION_STORAGE_KEY);
  if (!raw || raw.version !== AUCTION_VAULT_VERSION || raw.data) return null;
  const watchedAuctions = Array.isArray(raw.watchedAuctions) ? raw.watchedAuctions : [];
  const encryptedBids = isValidVault(raw.encryptedBids) ? raw.encryptedBids : null;
  return { watchedAuctions, encryptedBids };
}

/** Active record staged under the vault key (pre-clear migration). */
function readVaultKeyRecord(): ActiveRecord | null {
  const raw = readRaw<unknown>(VAULT_STORAGE_KEY);
  if (!raw) return null;
  let vault: EncryptedBidVault | null = null;
  let watchedAuctions: unknown = null;
  try {
    const parsed = parseBackup(raw);
    vault = parsed.vault;
  } catch {
    if (isValidVault(raw)) {
      vault = raw as EncryptedBidVault;
    } else if (raw && typeof raw === 'object' && 'encryptedBids' in raw) {
      const rec = raw as { watchedAuctions?: unknown; encryptedBids?: unknown };
      vault = isValidVault(rec.encryptedBids) ? rec.encryptedBids : null;
      watchedAuctions = rec.watchedAuctions;
    }
  }
  if (!vault) return null;
  return {
    watchedAuctions: Array.isArray(watchedAuctions) ? watchedAuctions : [],
    encryptedBids: vault,
  };
}

/** The currently active record: vault key (pre-clear) else canonical v1 else legacy. */
function readActive(): (ActiveRecord & { isLegacy: boolean }) | null {
  const vault = readVaultKeyRecord();
  if (vault) return { ...vault, isLegacy: false };
  const canonical = readCanonicalV1();
  if (canonical) return { ...canonical, isLegacy: false };
  const legacy = readLegacy();
  if (legacy)
    return { watchedAuctions: legacy.watchedAuctions, encryptedBids: null, isLegacy: true };
  return null;
}

function activeEncryptedVault(): EncryptedBidVault | null {
  const active = readActive();
  return active?.encryptedBids ?? null;
}

function writeActive(record: ActiveRecord): void {
  // While legacy plaintext exists, stage under the vault key and leave the
  // canonical legacy untouched until explicitly cleared.
  if (readLegacy()) {
    writeRaw(VAULT_STORAGE_KEY, record);
  } else {
    writeRaw(AUCTION_STORAGE_KEY, { version: AUCTION_VAULT_VERSION, ...record });
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

function fromBase64(input: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(input);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return Buffer.from(input, 'base64') as unknown as Uint8Array;
}

/** Re-encrypt bids using the in-memory derived key with a fresh IV every time. */
async function sealBids(bids: Record<string, AuctionBid>): Promise<EncryptedBidVault> {
  if (!activeKey || !activeKdfMeta) {
    throw new Error('Vault is not unlocked. Set a passphrase before saving bids.');
  }
  const subtle = globalThis.crypto.subtle;
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    activeKey,
    new TextEncoder().encode(JSON.stringify(bids)),
  );
  return {
    version: AUCTION_VAULT_VERSION,
    kdf: {
      algorithm: 'PBKDF2',
      hash: 'SHA-256',
      iterations: activeKdfMeta.iterations,
      salt: activeKdfMeta.salt,
    },
    cipher: { algorithm: 'AES-GCM', iv: toBase64(iv), keyLength: 256 },
    data: toBase64(new Uint8Array(ciphertext)),
  };
}

async function persistEncrypted(
  watchedAuctions: WatchedNameAuction[],
  bids: Record<string, AuctionBid>,
): Promise<void> {
  const vault = await sealBids(bids);
  writeActive({ watchedAuctions, encryptedBids: vault });
}

/** Decrypt a stored vault using the in-memory derived key (vault must be unlocked). */
async function decryptVaultWithActiveKey(
  vault: EncryptedBidVault,
): Promise<Record<string, AuctionBid>> {
  if (!activeKey) {
    throw new Error('Vault is not unlocked.');
  }
  const subtle = globalThis.crypto.subtle;
  const iv = fromBase64(vault.cipher.iv);
  const ciphertext = new Uint8Array(fromBase64(vault.data));
  const decrypted = await subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    activeKey,
    ciphertext,
  );
  const plaintext = new TextDecoder().decode(decrypted);
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error('Persisted recovery record is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Persisted recovery record is not a bids record.');
  }
  return parsed as Record<string, AuctionBid>;
}

/** Read back the persisted vault and verify every expected bid is durably stored. */
async function verifyStoredBids(expected: Record<string, AuctionBid>): Promise<void> {
  if (!activeKey) {
    throw new Error('Vault is not unlocked; cannot verify persisted recovery record.');
  }
  const active = readActive();
  const vault = active?.encryptedBids ?? null;
  if (!vault) {
    throw new Error('No encrypted vault found after persisting bid.');
  }
  const decrypted = await decryptVaultWithActiveKey(vault);
  for (const [name, bid] of Object.entries(expected)) {
    const stored = decrypted[name];
    if (!stored || JSON.stringify(stored) !== JSON.stringify(bid)) {
      throw new Error(`Persisted recovery record verification failed for ${name}.`);
    }
  }
}

export const useNameWatchlistStore = create<NameWatchlistState>((set, get) => ({
  watchedAuctions: [],
  bids: {},
  status: 'empty',
  error: null,
  hasLegacyPlaintext: false,
  hasEncryptedVault: false,

  inspectStorage() {
    const active = readActive();
    const hasLegacy = Boolean(active?.isLegacy);
    const hasEncrypted = Boolean(active?.encryptedBids);
    set({
      hasLegacyPlaintext: hasLegacy,
      hasEncryptedVault: hasEncrypted,
      watchedAuctions: active?.watchedAuctions ?? [],
      bids: {},
      status: hasLegacy ? 'legacy' : hasEncrypted ? 'locked' : 'empty',
      error: null,
    });
  },

  async setPassphrase(passphrase: string, iterations: number = DEFAULT_PBKDF2_ITERATIONS) {
    if (!passphrase || passphrase.length < 8) {
      throw new Error('Passphrase must be at least 8 characters.');
    }
    set({ error: null });
    clearActiveKey();
    try {
      const legacy = readLegacy();
      const existingVault = activeEncryptedVault();

      if (existingVault && !legacy) {
        throw new Error('An encrypted vault already exists. Use Unlock instead.');
      }

      let bidsToEncrypt: Record<string, AuctionBid>;
      let watchedAuctions = get().watchedAuctions;

      if (legacy) {
        // Migration: encrypt the legacy plaintext bids.
        bidsToEncrypt = legacy.bids;
        watchedAuctions = legacy.watchedAuctions;
      } else {
        bidsToEncrypt = {};
      }

      const vault = await encryptBids(passphrase, bidsToEncrypt, iterations);
      // Verify the replacement can be decrypted back before trusting it.
      const verified = await decryptBids(passphrase, vault);
      if (JSON.stringify(verified) !== JSON.stringify(bidsToEncrypt)) {
        throw new Error('Encrypted replacement failed verification.');
      }

      const salt = fromBase64(vault.kdf.salt);
      activeKey = await deriveKey(passphrase, salt, vault.kdf.iterations);
      activeKdfMeta = { salt: vault.kdf.salt, iterations: vault.kdf.iterations };

      writeActive({ watchedAuctions, encryptedBids: vault });

      set({
        bids: bidsToEncrypt,
        watchedAuctions,
        status: 'unlocked',
        error: null,
        hasLegacyPlaintext: Boolean(legacy),
        hasEncryptedVault: true,
      });
    } catch (err) {
      clearActiveKey();
      const message = err instanceof Error ? err.message : 'Failed to set up encryption.';
      set({ status: 'error', error: message });
      throw err;
    }
  },

  async unlock(passphrase) {
    set({ error: null });
    clearActiveKey();
    try {
      const vault = activeEncryptedVault();
      if (!vault) {
        throw new Error('No encrypted vault to unlock.');
      }
      const decrypted = await decryptBids(passphrase, vault);
      const salt = fromBase64(vault.kdf.salt);
      activeKey = await deriveKey(passphrase, salt, vault.kdf.iterations);
      activeKdfMeta = { salt: vault.kdf.salt, iterations: vault.kdf.iterations };
      set({
        bids: decrypted,
        watchedAuctions: readActive()?.watchedAuctions ?? [],
        status: 'unlocked',
        error: null,
        hasEncryptedVault: true,
      });
    } catch (err) {
      clearActiveKey();
      const message = err instanceof Error ? err.message : 'Unable to unlock vault.';
      set({ status: 'error', error: message });
      throw err;
    }
  },

  lock() {
    clearActiveKey();
    set({ bids: {}, status: 'locked', error: null });
  },

  watchAuction(auction) {
    const name = normalizeName(auction.name);
    const watched = [
      ...get().watchedAuctions.filter((item) => item.name !== name),
      { ...auction, name },
    ];
    const active = readActive();
    writeActive({ watchedAuctions: watched, encryptedBids: active?.encryptedBids ?? null });
    set({ watchedAuctions: watched });
  },

  unwatchAuction(name) {
    const watched = get().watchedAuctions.filter((item) => item.name !== normalizeName(name));
    const active = readActive();
    writeActive({ watchedAuctions: watched, encryptedBids: active?.encryptedBids ?? null });
    set({ watchedAuctions: watched });
  },

  async saveBid(bid) {
    if (get().status !== 'unlocked') {
      throw new Error('Vault is locked. Unlock with your passphrase before saving a bid.');
    }
    const name = normalizeName(bid.name);
    const bids = { ...get().bids, [name]: { ...bid, name } };
    const watched = [...get().watchedAuctions];
    if (!watched.some((item) => item.name === name)) {
      watched.push({ name, endsAt: 0 });
    }
    await persistEncrypted(watched, bids);
    // Read back and verify the recovery record is durably stored and decryptable
    // before it is trusted for on-chain submission.
    await verifyStoredBids(bids);
    set({ bids, watchedAuctions: watched });
  },

  async updateBidSubmission(name, submissionStatus, transactionHash) {
    if (get().status !== 'unlocked') {
      throw new Error('Vault is locked. Unlock with your passphrase before updating a bid.');
    }
    const key = normalizeName(name);
    const bid = get().bids[key];
    if (!bid) {
      throw new Error(`No recovery record exists for ${key}.`);
    }
    const updatedBid: AuctionBid = { ...bid, submissionStatus };
    if (
      (submissionStatus === 'committed' ||
        submissionStatus === 'unknown' ||
        submissionStatus === 'pending') &&
      transactionHash
    ) {
      updatedBid.transactionHash = transactionHash;
    } else {
      delete updatedBid.transactionHash;
    }
    const bids = { ...get().bids, [key]: updatedBid };
    await persistEncrypted(get().watchedAuctions, bids);
    await verifyStoredBids(bids);
    set({ bids });
  },

  async markBidRevealed(name) {
    if (get().status !== 'unlocked') {
      throw new Error('Vault is locked. Unlock with your passphrase before revealing a bid.');
    }
    const key = normalizeName(name);
    const bid = get().bids[key];
    if (!bid) return;
    const bids = { ...get().bids, [key]: { ...bid, revealed: true } };
    await persistEncrypted(get().watchedAuctions, bids);
    set({ bids });
  },

  async removeBid(name) {
    if (get().status !== 'unlocked') {
      throw new Error('Vault is locked. Unlock with your passphrase before removing a bid.');
    }
    const key = normalizeName(name);
    const bids = { ...get().bids };
    delete bids[key];
    await persistEncrypted(get().watchedAuctions, bids);
    set({ bids });
  },

  async exportBackup() {
    const vault = activeEncryptedVault();
    if (!vault) {
      throw new Error('No encrypted vault to back up.');
    }
    return JSON.stringify(createBackup(vault));
  },

  async importBackup(backup, passphrase, { replace = false } = {}) {
    if (!passphrase || passphrase.length < 8) {
      throw new Error('Passphrase must be at least 8 characters.');
    }
    set({ error: null });

    // Refuse to replace a non-empty current vault without explicit confirmation.
    // This check runs before any decryption or key derivation so the current
    // vault and its in-memory key are preserved on refusal.
    const currentVault = activeEncryptedVault();
    if (currentVault && !replace) {
      const message =
        'Current vault already contains bid recovery secrets. Export your current vault first, or confirm replacement.';
      set({ status: 'error', error: message });
      throw new Error(message);
    }

    clearActiveKey();
    try {
      const input: unknown = typeof backup === 'string' ? JSON.parse(backup) : backup;
      const parsed = parseBackup(input);
      // Decrypt the imported backup to validate the passphrase and ciphertext and
      // inspect the recovered bids. This does not touch the current vault.
      const decrypted = await decryptBids(passphrase, parsed.vault);
      const salt = fromBase64(parsed.vault.kdf.salt);
      activeKey = await deriveKey(passphrase, salt, parsed.vault.kdf.iterations);
      activeKdfMeta = { salt: parsed.vault.kdf.salt, iterations: parsed.vault.kdf.iterations };
      // Only now, after successful validation, overwrite the active record.
      writeActive({ watchedAuctions: [], encryptedBids: parsed.vault });
      set({
        bids: decrypted,
        watchedAuctions: [],
        status: 'unlocked',
        error: null,
        hasEncryptedVault: true,
        hasLegacyPlaintext: Boolean(readLegacy()),
      });
    } catch (err) {
      clearActiveKey();
      const message = err instanceof Error ? err.message : 'Failed to import backup.';
      set({ status: 'error', error: message });
      throw err;
    }
  },

  async clearLegacy() {
    const legacy = readLegacy();
    if (!legacy) {
      // Nothing legacy to clear. Safe no-op for repeated attempts.
      return false;
    }
    const vault = activeEncryptedVault();
    if (!vault) {
      throw new Error(
        'Cannot clear legacy plaintext: no verified encrypted replacement exists. Back up and migrate first.',
      );
    }
    const active = readActive();
    // Replace the canonical legacy plaintext with the verified encrypted vault.
    writeRaw(AUCTION_STORAGE_KEY, {
      version: AUCTION_VAULT_VERSION,
      watchedAuctions: active?.watchedAuctions ?? legacy.watchedAuctions,
      encryptedBids: vault,
    });
    removeRaw(VAULT_STORAGE_KEY);
    set({ hasLegacyPlaintext: false, hasEncryptedVault: true });
    return true;
  },

  getBids() {
    return get().bids;
  },

  getStatus() {
    return get().status;
  },
}));

let storageListener: ((event: StorageEvent) => void) | null = null;

export function initNameWatchlistSync() {
  if (typeof window === 'undefined' || storageListener !== null) return;
  if (typeof window.addEventListener !== 'function') return;

  storageListener = (event) => {
    if (event.key === AUCTION_STORAGE_KEY || event.key === VAULT_STORAGE_KEY) {
      useNameWatchlistStore.getState().inspectStorage();
    } else if (event.key === null) {
      clearActiveKey();
      useNameWatchlistStore.getState().inspectStorage();
    }
  };

  window.addEventListener('storage', storageListener);
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
