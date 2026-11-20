/**
 * Encrypted storage format for Wraith Name auction recovery material.
 *
 * The auction watchlist persists sealed-bid recovery secrets (saltHex, bid
 * amount, deposit amount) so a bid can be revealed after the commit phase.
 * These values are sensitive: revealing them without authorisation lets an
 * attacker claim the name or steal the deposit. They must never be written to
 * localStorage in plaintext.
 *
 * Format (version 1):
 * {
 *   version: 1,
 *   kdf: { algorithm: 'PBKDF2', hash: 'SHA-256', iterations: N, salt: base64 },
 *   cipher: { algorithm: 'AES-GCM', iv: base64, keyLength: 256 },
 *   data: base64   // AES-GCM ciphertext || 16-byte authentication tag
 * }
 *
 * The plaintext payload is the JSON serialisation of the bids record.
 * Only the encrypted payload and the non-secret metadata required to derive
 * the key and verify the ciphertext are ever persisted. The passphrase, the
 * derived key, and the plaintext bids are never written to localStorage.
 */

export interface AuctionBid {
  name: string;
  amountStroops: string;
  depositStroops: string;
  saltHex: string;
  revealed: boolean;
  submissionStatus?: 'pending' | 'committed' | 'failed' | 'unknown';
  transactionHash?: string;
}

export const AUCTION_VAULT_VERSION = 1;
export const AUCTION_STORAGE_KEY = 'wraith-name-auction-watchlist';
export const LEGACY_STORAGE_KEY = 'wraith-name-auction-watchlist';
export const LEGACY_FORMAT_VERSION = 0;

// Production-grade PBKDF2 iteration count (OWASP 2023 baseline for
// PBKDF2-HMAC-SHA256). Tests override this via the `iterations` argument.
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;

export const SALT_LENGTH = 16; // bytes
export const IV_LENGTH = 12; // bytes (AES-GCM recommended nonce size)
export const KEY_BITS = 256;

export interface EncryptedBidVault {
  version: number;
  kdf: {
    algorithm: 'PBKDF2';
    hash: 'SHA-256';
    iterations: number;
    salt: string; // base64
  };
  cipher: {
    algorithm: 'AES-GCM';
    iv: string; // base64
    keyLength: number; // bits
  };
  data: string; // base64 (ciphertext || 16-byte GCM tag)
}

export interface BackupPayload {
  type: 'wraith-name-auction-backup';
  version: 1;
  exportedAt: number;
  vault: EncryptedBidVault;
}

export class AuctionEncryptionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid_vault'
      | 'decrypt_failed'
      | 'unsupported_version' = 'decrypt_failed',
  ) {
    super(message);
    this.name = 'AuctionEncryptionError';
  }
}

export class InvalidVaultError extends AuctionEncryptionError {
  constructor(message: string) {
    super(message, 'invalid_vault');
  }
}

export class UnsupportedVersionError extends AuctionEncryptionError {
  constructor(version: unknown) {
    super(`Unsupported vault version: ${String(version)}`, 'unsupported_version');
  }
}

function isSecureContextAvailable(): boolean {
  return typeof globalThis.crypto?.subtle === 'object';
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  // Node fallback
  return Buffer.from(binary, 'binary').toString('base64');
}

function fromBase64(input: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(input);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  // Node fallback
  return Buffer.from(input, 'base64') as unknown as Uint8Array;
}

function getSubtle(): SubtleCrypto {
  if (!isSecureContextAvailable()) {
    throw new AuctionEncryptionError('Web Crypto API is not available in this environment');
  }
  return globalThis.crypto.subtle!;
}

export function generateRandomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Derive an AES-GCM encryption key from a passphrase using PBKDF2-HMAC-SHA256.
 * The returned CryptoKey is non-extractable so the raw key bytes never leave
 * the Web Crypto API boundary.
 */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const keyMaterial = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt a plaintext string with a passphrase. Produces a fresh random salt
 * (for key derivation) and a fresh random IV (for encryption) on every call.
 * Returns a versioned, self-describing encrypted vault.
 */
export async function encrypt(
  passphrase: string,
  plaintext: string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Promise<EncryptedBidVault> {
  const salt = generateRandomBytes(SALT_LENGTH);
  const iv = generateRandomBytes(IV_LENGTH);
  const key = await deriveKey(passphrase, salt, iterations);
  const subtle = getSubtle();
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    version: AUCTION_VAULT_VERSION,
    kdf: { algorithm: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    cipher: { algorithm: 'AES-GCM', iv: toBase64(iv), keyLength: KEY_BITS },
    data: toBase64(new Uint8Array(ciphertext)),
  };
}

/**
 * Decrypt an encrypted vault with a passphrase. Validates the payload and its
 * metadata before attempting decryption. Rejects on wrong passphrase or
 * tampered/corrupted ciphertext (AES-GCM authentication failure).
 */
export async function decrypt(passphrase: string, vault: EncryptedBidVault): Promise<string> {
  validateVault(vault);
  const salt = fromBase64(vault.kdf.salt);
  const iv = fromBase64(vault.cipher.iv);
  const ciphertext = new Uint8Array(fromBase64(vault.data));
  const key = await deriveKey(passphrase, salt, vault.kdf.iterations);
  const subtle = getSubtle();
  let decrypted: ArrayBuffer;
  try {
    decrypted = await subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      ciphertext,
    );
  } catch (err) {
    throw new AuctionEncryptionError(
      'Unable to decrypt recovery material: incorrect passphrase or corrupted data.',
      'decrypt_failed',
    );
  }
  return new TextDecoder().decode(decrypted);
}

/** Structural validation of an encrypted vault before decryption is attempted. */
export function validateVault(vault: unknown): asserts vault is EncryptedBidVault {
  if (!vault || typeof vault !== 'object') {
    throw new InvalidVaultError('Vault payload is missing or not an object.');
  }
  const v = vault as Record<string, unknown>;
  if (v.version !== AUCTION_VAULT_VERSION) {
    throw new UnsupportedVersionError(v.version);
  }
  if (!v.kdf || typeof v.kdf !== 'object') {
    throw new InvalidVaultError('Vault is missing key derivation metadata.');
  }
  const kdf = v.kdf as Record<string, unknown>;
  if (kdf.algorithm !== 'PBKDF2' || kdf.hash !== 'SHA-256') {
    throw new InvalidVaultError('Unsupported key derivation algorithm.');
  }
  if (
    typeof kdf.iterations !== 'number' ||
    !Number.isFinite(kdf.iterations) ||
    kdf.iterations < 1
  ) {
    throw new InvalidVaultError('Vault key derivation iteration count is invalid.');
  }
  if (typeof kdf.salt !== 'string') {
    throw new InvalidVaultError('Vault is missing key derivation salt.');
  }
  let saltBytes: Uint8Array;
  try {
    saltBytes = fromBase64(kdf.salt as string);
  } catch {
    throw new InvalidVaultError('Vault key derivation salt is not valid base64.');
  }
  if (saltBytes.length !== SALT_LENGTH) {
    throw new InvalidVaultError('Vault key derivation salt has an unexpected length.');
  }
  if (!v.cipher || typeof v.cipher !== 'object') {
    throw new InvalidVaultError('Vault is missing cipher metadata.');
  }
  const cipher = v.cipher as Record<string, unknown>;
  if (cipher.algorithm !== 'AES-GCM') {
    throw new InvalidVaultError('Unsupported cipher algorithm.');
  }
  if (typeof cipher.keyLength !== 'number' || cipher.keyLength !== KEY_BITS) {
    throw new InvalidVaultError('Vault cipher key length is invalid.');
  }
  if (typeof cipher.iv !== 'string') {
    throw new InvalidVaultError('Vault is missing encryption IV.');
  }
  let ivBytes: Uint8Array;
  try {
    ivBytes = fromBase64(cipher.iv as string);
  } catch {
    throw new InvalidVaultError('Vault encryption IV is not valid base64.');
  }
  if (ivBytes.length !== IV_LENGTH) {
    throw new InvalidVaultError('Vault encryption IV has an unexpected length.');
  }
  if (typeof v.data !== 'string') {
    throw new InvalidVaultError('Vault is missing encrypted data.');
  }
  let dataBytes: Uint8Array;
  try {
    dataBytes = fromBase64(v.data as string);
  } catch {
    throw new InvalidVaultError('Vault encrypted data is not valid base64.');
  }
  // AES-GCM ciphertext must be at least the 16-byte authentication tag.
  if (dataBytes.length < 16) {
    throw new InvalidVaultError(
      'Vault encrypted data is too short to contain an authentication tag.',
    );
  }
}

export function isValidVault(vault: unknown): vault is EncryptedBidVault {
  try {
    validateVault(vault);
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypt the bid recovery map with a passphrase. The plaintext payload is the
 * JSON serialisation of the bids record.
 */
export async function encryptBids(
  passphrase: string,
  bids: Record<string, AuctionBid>,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Promise<EncryptedBidVault> {
  return encrypt(passphrase, JSON.stringify(bids), iterations);
}

/**
 * Decrypt an encrypted vault into the bid recovery map. Throws
 * AuctionEncryptionError on wrong passphrase, corruption, or invalid payload,
 * and a plain Error if the decrypted payload is not a valid bids record.
 */
export async function decryptBids(
  passphrase: string,
  vault: EncryptedBidVault,
): Promise<Record<string, AuctionBid>> {
  const plaintext = await decrypt(passphrase, vault);
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new AuctionEncryptionError(
      'Decrypted recovery material is not valid JSON.',
      'decrypt_failed',
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AuctionEncryptionError(
      'Decrypted recovery material is not a bids record.',
      'decrypt_failed',
    );
  }
  const bids = parsed as Record<string, unknown>;
  const invalidKeys: string[] = [];
  for (const [name, value] of Object.entries(bids)) {
    if (!isAuctionBid(value)) {
      invalidKeys.push(name);
    }
  }
  if (invalidKeys.length > 0) {
    throw new AuctionEncryptionError(
      `Decrypted recovery material contains malformed bid(s): ${invalidKeys.join(', ')}.`,
      'decrypt_failed',
    );
  }
  return bids as Record<string, AuctionBid>;
}

/** Build a documented, versioned backup payload suitable for export and later recovery. */
export function createBackup(vault: EncryptedBidVault): BackupPayload {
  validateVault(vault);
  return {
    type: 'wraith-name-auction-backup',
    version: 1,
    exportedAt: Date.now(),
    vault,
  };
}

/** Parse and validate a backup payload (wrapper or raw vault). */
export function parseBackup(input: unknown): BackupPayload {
  if (!input || typeof input !== 'object') {
    throw new InvalidVaultError('Backup payload is missing or not an object.');
  }
  const p = input as Record<string, unknown>;
  if (p.type === 'wraith-name-auction-backup' && p.vault) {
    const vault = p.vault as EncryptedBidVault;
    validateVault(vault);
    return {
      type: 'wraith-name-auction-backup',
      version: 1,
      exportedAt: typeof p.exportedAt === 'number' ? p.exportedAt : Date.now(),
      vault,
    };
  }
  // Backward-compatible: raw vault.
  validateVault(p);
  return {
    type: 'wraith-name-auction-backup',
    version: 1,
    exportedAt: Date.now(),
    vault: p as EncryptedBidVault,
  };
}

export function isAuctionBid(value: unknown): value is AuctionBid {
  if (!value || typeof value !== 'object') return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.name === 'string' &&
    typeof b.amountStroops === 'string' &&
    typeof b.depositStroops === 'string' &&
    typeof b.saltHex === 'string' &&
    typeof b.revealed === 'boolean' &&
    (b.submissionStatus === undefined ||
      ['pending', 'committed', 'failed', 'unknown'].includes(String(b.submissionStatus))) &&
    (b.transactionHash === undefined || typeof b.transactionHash === 'string')
  );
}
