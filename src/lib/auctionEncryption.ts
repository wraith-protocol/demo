export interface AuctionBid {
  name: string;
  amountStroops: string;
  depositStroops: string;
  saltHex: string;
  revealed: boolean;
}

export const AUCTION_VAULT_VERSION = 1;
export const AUCTION_STORAGE_KEY = 'wraith-name-auction-watchlist';
export const VAULT_STORAGE_KEY = `${AUCTION_STORAGE_KEY}.vault`;
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;
export const MIN_PBKDF2_ITERATIONS = 600_000;
export const MAX_PBKDF2_ITERATIONS = 1_000_000;
export const SALT_LENGTH = 16;
export const IV_LENGTH = 12;
export const KEY_BITS = 256;
export const MAX_AUCTION_BIDS = 500;
const MAX_VAULT_BYTES = 100_000;
const MAX_BID_AMOUNT_LENGTH = 80;

export interface EncryptedBidVault {
  version: number;
  kdf: {
    algorithm: 'PBKDF2';
    hash: 'SHA-256';
    iterations: number;
    salt: string;
  };
  cipher: {
    algorithm: 'AES-GCM';
    iv: string;
    keyLength: number;
  };
  data: string;
}

export interface BackupPayload {
  type: 'wraith-name-auction-backup';
  version: 1;
  exportedAt: number;
  vault: EncryptedBidVault;
}

export interface VaultKeyMetadata {
  salt: string;
  iterations: number;
}

export class AuctionEncryptionError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid_vault' | 'decrypt_failed' | 'unsupported_version',
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

function getSubtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new AuctionEncryptionError('Web Crypto API is unavailable.', 'decrypt_failed');
  }
  return globalThis.crypto.subtle;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  if (typeof btoa !== 'function') {
    throw new AuctionEncryptionError('Base64 encoding is unavailable.', 'decrypt_failed');
  }
  return btoa(binary);
}

function fromBase64(input: string): Uint8Array {
  if (
    input.length === 0 ||
    input.length > MAX_VAULT_BYTES * 2 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input)
  ) {
    throw new InvalidVaultError('Vault contains invalid base64 data.');
  }
  let binary: string;
  try {
    binary = atob(input);
  } catch {
    throw new InvalidVaultError('Vault contains invalid base64 data.');
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (toBase64(bytes) !== input) {
    throw new InvalidVaultError('Vault contains non-canonical base64 data.');
  }
  return bytes;
}

function validateIterations(iterations: unknown): asserts iterations is number {
  if (
    typeof iterations !== 'number' ||
    !Number.isSafeInteger(iterations) ||
    iterations < MIN_PBKDF2_ITERATIONS ||
    iterations > MAX_PBKDF2_ITERATIONS
  ) {
    throw new InvalidVaultError('Vault PBKDF2 iteration count is outside the supported range.');
  }
}

export function generateRandomBytes(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 1 || length > 65_536) {
    throw new RangeError('Random byte length is invalid.');
  }
  if (!globalThis.crypto?.getRandomValues) {
    throw new AuctionEncryptionError(
      'Secure random number generation is unavailable.',
      'decrypt_failed',
    );
  }
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new TypeError('Passphrase is required.');
  }
  if (!(salt instanceof Uint8Array) || salt.length !== SALT_LENGTH) {
    throw new InvalidVaultError('PBKDF2 salt has an unexpected length.');
  }
  validateIterations(iterations);
  const subtle = getSubtle();
  const material = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

function validateBid(value: unknown): value is AuctionBid {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const bid = value as Record<string, unknown>;
  return (
    typeof bid.name === 'string' &&
    bid.name.length > 0 &&
    bid.name.length <= 128 &&
    bid.name === bid.name.trim().toLowerCase() &&
    /^[a-z0-9][a-z0-9.-]*$/.test(bid.name) &&
    typeof bid.amountStroops === 'string' &&
    bid.amountStroops.length <= MAX_BID_AMOUNT_LENGTH &&
    /^(0|[1-9]\d*)$/.test(bid.amountStroops) &&
    typeof bid.depositStroops === 'string' &&
    bid.depositStroops.length <= MAX_BID_AMOUNT_LENGTH &&
    /^(0|[1-9]\d*)$/.test(bid.depositStroops) &&
    typeof bid.saltHex === 'string' &&
    /^[0-9a-f]{64}$/i.test(bid.saltHex) &&
    typeof bid.revealed === 'boolean'
  );
}

export function isAuctionBid(value: unknown): value is AuctionBid {
  return validateBid(value);
}

export function validateBids(value: unknown): asserts value is Record<string, AuctionBid> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AuctionEncryptionError('Recovery material is not a bids record.', 'decrypt_failed');
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_AUCTION_BIDS) {
    throw new AuctionEncryptionError('Recovery material contains too many bids.', 'decrypt_failed');
  }
  for (const [name, bid] of entries) {
    if (name !== name.trim().toLowerCase() || !validateBid(bid) || bid.name !== name) {
      throw new AuctionEncryptionError(
        'Recovery material contains a malformed bid record.',
        'decrypt_failed',
      );
    }
  }
}

function assertMetadata(metadata: VaultKeyMetadata): Uint8Array {
  validateIterations(metadata.iterations);
  const salt = fromBase64(metadata.salt);
  if (salt.length !== SALT_LENGTH) {
    throw new InvalidVaultError('Vault PBKDF2 salt has an unexpected length.');
  }
  return salt;
}

export async function encrypt(
  passphrase: string,
  plaintext: string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Promise<EncryptedBidVault> {
  const salt = generateRandomBytes(SALT_LENGTH);
  const iv = generateRandomBytes(IV_LENGTH);
  const key = await deriveKey(passphrase, salt, iterations);
  const ciphertext = await getSubtle().encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    version: AUCTION_VAULT_VERSION,
    kdf: {
      algorithm: 'PBKDF2',
      hash: 'SHA-256',
      iterations,
      salt: toBase64(salt),
    },
    cipher: { algorithm: 'AES-GCM', iv: toBase64(iv), keyLength: KEY_BITS },
    data: toBase64(new Uint8Array(ciphertext)),
  };
}

export async function encryptBids(
  passphrase: string,
  bids: Record<string, AuctionBid>,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Promise<EncryptedBidVault> {
  validateBids(bids);
  return encrypt(passphrase, JSON.stringify(bids), iterations);
}

export async function encryptBidsWithKey(
  key: CryptoKey,
  metadata: VaultKeyMetadata,
  bids: Record<string, AuctionBid>,
): Promise<EncryptedBidVault> {
  validateBids(bids);
  const salt = assertMetadata(metadata);
  const iv = generateRandomBytes(IV_LENGTH);
  const ciphertext = await getSubtle().encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(JSON.stringify(bids)),
  );
  return {
    version: AUCTION_VAULT_VERSION,
    kdf: {
      algorithm: 'PBKDF2',
      hash: 'SHA-256',
      iterations: metadata.iterations,
      salt: toBase64(salt),
    },
    cipher: { algorithm: 'AES-GCM', iv: toBase64(iv), keyLength: KEY_BITS },
    data: toBase64(new Uint8Array(ciphertext)),
  };
}

export function validateVault(vault: unknown): asserts vault is EncryptedBidVault {
  if (!vault || typeof vault !== 'object' || Array.isArray(vault)) {
    throw new InvalidVaultError('Vault payload is missing or not an object.');
  }
  const value = vault as Record<string, unknown>;
  if (value.version !== AUCTION_VAULT_VERSION) {
    throw new UnsupportedVersionError(value.version);
  }
  if (!value.kdf || typeof value.kdf !== 'object' || Array.isArray(value.kdf)) {
    throw new InvalidVaultError('Vault is missing key derivation metadata.');
  }
  const kdf = value.kdf as Record<string, unknown>;
  if (kdf.algorithm !== 'PBKDF2' || kdf.hash !== 'SHA-256') {
    throw new InvalidVaultError('Vault uses an unsupported key derivation algorithm.');
  }
  validateIterations(kdf.iterations);
  if (typeof kdf.salt !== 'string') {
    throw new InvalidVaultError('Vault is missing PBKDF2 salt.');
  }
  const salt = fromBase64(kdf.salt);
  if (salt.length !== SALT_LENGTH) {
    throw new InvalidVaultError('Vault PBKDF2 salt has an unexpected length.');
  }
  if (!value.cipher || typeof value.cipher !== 'object' || Array.isArray(value.cipher)) {
    throw new InvalidVaultError('Vault is missing cipher metadata.');
  }
  const cipher = value.cipher as Record<string, unknown>;
  if (cipher.algorithm !== 'AES-GCM' || cipher.keyLength !== KEY_BITS) {
    throw new InvalidVaultError('Vault uses unsupported cipher metadata.');
  }
  if (typeof cipher.iv !== 'string') {
    throw new InvalidVaultError('Vault is missing its AES-GCM IV.');
  }
  const iv = fromBase64(cipher.iv);
  if (iv.length !== IV_LENGTH) {
    throw new InvalidVaultError('Vault AES-GCM IV has an unexpected length.');
  }
  if (typeof value.data !== 'string') {
    throw new InvalidVaultError('Vault is missing encrypted data.');
  }
  const data = fromBase64(value.data);
  if (data.length < 16 || data.length > MAX_VAULT_BYTES) {
    throw new InvalidVaultError('Vault ciphertext length is invalid.');
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

export async function decryptWithKey(key: CryptoKey, vault: EncryptedBidVault): Promise<string> {
  validateVault(vault);
  try {
    const decrypted = await getSubtle().decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64(vault.cipher.iv) as unknown as BufferSource,
      },
      key,
      fromBase64(vault.data) as unknown as BufferSource,
    );
    return new TextDecoder('utf-8', { fatal: true }).decode(decrypted);
  } catch {
    throw new AuctionEncryptionError(
      'Unable to decrypt recovery material: incorrect passphrase or corrupted data.',
      'decrypt_failed',
    );
  }
}

export async function decrypt(passphrase: string, vault: EncryptedBidVault): Promise<string> {
  validateVault(vault);
  const key = await deriveVaultKey(passphrase, vault);
  return decryptWithKey(key, vault);
}

export async function deriveVaultKey(
  passphrase: string,
  vault: EncryptedBidVault,
): Promise<CryptoKey> {
  validateVault(vault);
  return deriveKey(passphrase, fromBase64(vault.kdf.salt), vault.kdf.iterations);
}

function parseBids(plaintext: string): Record<string, AuctionBid> {
  let bids: unknown;
  try {
    bids = JSON.parse(plaintext);
  } catch {
    throw new AuctionEncryptionError(
      'Decrypted recovery material is not valid JSON.',
      'decrypt_failed',
    );
  }
  validateBids(bids);
  return bids;
}

export async function decryptBids(
  passphrase: string,
  vault: EncryptedBidVault,
): Promise<Record<string, AuctionBid>> {
  return parseBids(await decrypt(passphrase, vault));
}

export async function decryptBidsWithKey(
  key: CryptoKey,
  vault: EncryptedBidVault,
): Promise<Record<string, AuctionBid>> {
  return parseBids(await decryptWithKey(key, vault));
}

export function createBackup(vault: EncryptedBidVault): BackupPayload {
  validateVault(vault);
  return {
    type: 'wraith-name-auction-backup',
    version: 1,
    exportedAt: Date.now(),
    vault,
  };
}

export function parseBackup(input: unknown): BackupPayload {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new InvalidVaultError('Backup payload is missing or malformed.');
  }
  const value = input as Record<string, unknown>;
  if (value.type === 'wraith-name-auction-backup') {
    if (
      value.version !== 1 ||
      typeof value.exportedAt !== 'number' ||
      !Number.isFinite(value.exportedAt)
    ) {
      throw new InvalidVaultError('Backup metadata is invalid.');
    }
    validateVault(value.vault);
    return {
      type: 'wraith-name-auction-backup',
      version: 1,
      exportedAt: value.exportedAt,
      vault: value.vault,
    };
  }
  validateVault(value);
  return {
    type: 'wraith-name-auction-backup',
    version: 1,
    exportedAt: Date.now(),
    vault: value,
  };
}
