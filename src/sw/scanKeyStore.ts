/**
 * Minimum key material a background scanner may hold: the viewing key and the
 * spending PUBLIC key. A spending secret has no field here by design.
 */
export interface ScanKeyMaterial {
  viewingKey: Uint8Array;
  spendingPubKey: Uint8Array;
}

export interface SealedScanKey {
  publicKey: string;
  version: 1;
  iv: Uint8Array;
  ciphertext: Uint8Array;
  sealedAt: number;
}

/** Storage seam: IndexedDB in the browser, a Map in tests. */
export interface ScanKeyBackend {
  getRecord(publicKey: string): Promise<SealedScanKey | undefined>;
  getWrappingKey(publicKey: string): Promise<CryptoKey | undefined>;
  /** Writes the sealed record and its wrapping key atomically. */
  putSealed(record: SealedScanKey, wrappingKey: CryptoKey): Promise<void>;
  deleteWrappingKey(publicKey: string): Promise<void>;
  clearWrappingKeys(): Promise<void>;
  remove(publicKey: string): Promise<void>;
}

export type OpenScanKeyResult =
  | { status: 'ok'; material: ScanKeyMaterial }
  | { status: 'locked' } // sealed record exists, wrapping key is gone
  | { status: 'missing' } // nothing registered
  | { status: 'invalid' }; // corrupt, or sealed for another account

const asBuffer = (bytes: Uint8Array) => bytes as unknown as BufferSource;
const aadFor = (publicKey: string) => new TextEncoder().encode(`wraith-scan-key:v1:${publicKey}`);

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error('Invalid hex key');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Copies ONLY the two permitted fields; anything else on the object is dropped. */
export function toScanKeyMaterial(keys: {
  viewingKey: Uint8Array | string;
  spendingPubKey: Uint8Array;
}): ScanKeyMaterial {
  return {
    viewingKey:
      typeof keys.viewingKey === 'string'
        ? hexToBytes(keys.viewingKey)
        : new Uint8Array(keys.viewingKey),
    spendingPubKey: new Uint8Array(keys.spendingPubKey),
  };
}

export function wipeScanKeyMaterial(material: ScanKeyMaterial): void {
  material.viewingKey.fill(0);
  material.spendingPubKey.fill(0);
}

function pack(m: ScanKeyMaterial): Uint8Array {
  const { viewingKey: v, spendingPubKey: s } = m;
  if (v.length === 0 || v.length > 255 || s.length === 0 || s.length > 255) {
    throw new Error('Invalid scan key material');
  }
  const out = new Uint8Array(2 + v.length + s.length);
  out[0] = v.length;
  out[1] = s.length;
  out.set(v, 2);
  out.set(s, 2 + v.length);
  return out;
}

function unpack(bytes: Uint8Array): ScanKeyMaterial {
  const vLen = bytes[0];
  const sLen = bytes[1];
  if (bytes.length !== 2 + vLen + sLen) throw new Error('Malformed scan key payload');
  return {
    viewingKey: bytes.slice(2, 2 + vLen),
    spendingPubKey: bytes.slice(2 + vLen, 2 + vLen + sLen),
  };
}

/** Encrypts the material under a fresh non-extractable AES-GCM key and persists both. */
export async function sealScanKey(
  backend: ScanKeyBackend,
  publicKey: string,
  material: ScanKeyMaterial,
): Promise<void> {
  const plaintext = pack(material);
  try {
    const wrappingKey = await globalThis.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: asBuffer(iv), additionalData: asBuffer(aadFor(publicKey)) },
      wrappingKey,
      asBuffer(plaintext),
    );
    await backend.putSealed(
      { publicKey, version: 1, iv, ciphertext: new Uint8Array(ciphertext), sealedAt: Date.now() },
      wrappingKey,
    );
  } finally {
    plaintext.fill(0);
  }
}

export async function openScanKey(
  backend: ScanKeyBackend,
  publicKey: string,
): Promise<OpenScanKeyResult> {
  const record = await backend.getRecord(publicKey);
  if (!record) return { status: 'missing' };
  const wrappingKey = await backend.getWrappingKey(publicKey);
  if (!wrappingKey) return { status: 'locked' };
  try {
    const plaintext = new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: asBuffer(record.iv),
          additionalData: asBuffer(aadFor(publicKey)),
        },
        wrappingKey,
        asBuffer(record.ciphertext),
      ),
    );
    try {
      return { status: 'ok', material: unpack(plaintext) };
    } finally {
      plaintext.fill(0);
    }
  } catch {
    return { status: 'invalid' };
  }
}

export async function isScanKeyUnlocked(
  backend: ScanKeyBackend,
  publicKey: string,
): Promise<boolean> {
  return (
    (await backend.getRecord(publicKey)) !== undefined &&
    (await backend.getWrappingKey(publicKey)) !== undefined
  );
}

export async function hasScanKey(backend: ScanKeyBackend, publicKey: string): Promise<boolean> {
  return (await backend.getRecord(publicKey)) !== undefined;
}

/** Lock: the worker can no longer decrypt. Unlock = seal again from the page. */
export const lockScanKey = (backend: ScanKeyBackend, publicKey: string) =>
  backend.deleteWrappingKey(publicKey);
export const lockAllScanKeys = (backend: ScanKeyBackend) => backend.clearWrappingKeys();
/** Key removal: wipes the sealed blob and the wrapping key. */
export const removeScanKey = (backend: ScanKeyBackend, publicKey: string) =>
  backend.remove(publicKey);

const SPENDING_SECRET_NAME = /spending(?!pub)|stealthPrivate/i;

/**
 * Returns the path of the first field that looks like a spending secret
 * (spending scalar/key/seed or a stealth private scalar), or null.
 * Workers use it to refuse any message carrying one.
 */
export function findSpendingSecretField(value: unknown, path = '', depth = 0): string | null {
  if (depth > 6 || value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) {
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    const here = path ? `${path}.${key}` : key;
    if (SPENDING_SECRET_NAME.test(key)) return here;
    const nested = findSpendingSecretField(child, here, depth + 1);
    if (nested) return nested;
  }
  return null;
}
