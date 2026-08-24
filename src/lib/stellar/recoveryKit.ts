export interface RecoveryKitData {
  version: 1;
  chain: string;
  metaAddress: string;
  viewingScalarHex: string;
  viewingPubKeyHex?: string;
  spendingPubKeyHex?: string;
  spendingScalarHex?: string;
  labels?: Record<string, any>;
  createdAt: number;
}

export interface EncryptedRecoveryKit {
  version: 1;
  salt: string;
  iv: string;
  iterations: number;
  ciphertext: string;
}

export interface PassphraseStrength {
  valid: boolean;
  score: number; // 0 to 4
  label: 'Weak' | 'Fair' | 'Good' | 'Strong';
  message?: string;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (cleanHex.length % 2 !== 0) {
    throw new Error('Invalid hex string length');
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function validatePassphrase(passphrase: string): PassphraseStrength {
  if (!passphrase || passphrase.length < 8) {
    return {
      valid: false,
      score: 0,
      label: 'Weak',
      message: 'Passphrase must be at least 8 characters long',
    };
  }

  let score = 1;
  if (passphrase.length >= 12) score += 1;
  if (/[A-Z]/.test(passphrase) && /[a-z]/.test(passphrase)) score += 1;
  if (/[0-9]/.test(passphrase)) score += 1;
  if (/[^A-Za-z0-9]/.test(passphrase)) score += 1;

  score = Math.min(score, 4);

  const labels: Record<number, 'Weak' | 'Fair' | 'Good' | 'Strong'> = {
    1: 'Weak',
    2: 'Fair',
    3: 'Good',
    4: 'Strong',
  };

  return {
    valid: true,
    score,
    label: labels[score] || 'Fair',
  };
}

export function generateRecoveryFilename(metaAddress: string): string {
  const prefix = metaAddress
    .replace(/^st:[a-z]+:/i, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 12);
  const cleanPrefix = prefix || 'stealth';
  const dateStr = new Date().toISOString().slice(0, 10);
  return `wraith-recovery-kit-${cleanPrefix}-${dateStr}.json`;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function exportRecoveryKit(options: {
  passphrase: string;
  chain: string;
  metaAddress: string;
  viewingScalarHex: string;
  viewingPubKeyHex?: string;
  spendingPubKeyHex?: string;
  spendingScalarHex?: string;
  labels?: Record<string, any>;
}): Promise<EncryptedRecoveryKit> {
  const strength = validatePassphrase(options.passphrase);
  if (!strength.valid) {
    throw new Error(strength.message || 'Passphrase must be at least 8 characters long');
  }

  const payload: RecoveryKitData = {
    version: 1,
    chain: options.chain,
    metaAddress: options.metaAddress,
    viewingScalarHex: options.viewingScalarHex,
    viewingPubKeyHex: options.viewingPubKeyHex,
    spendingPubKeyHex: options.spendingPubKeyHex,
    spendingScalarHex: options.spendingScalarHex,
    labels: options.labels,
    createdAt: Date.now(),
  };

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = 100000;

  const key = await deriveKey(options.passphrase, salt, iterations);
  const enc = new TextEncoder();
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    enc.encode(JSON.stringify(payload)),
  );

  return {
    version: 1,
    salt: bytesToHex(salt),
    iv: bytesToHex(iv),
    iterations,
    ciphertext: bytesToHex(new Uint8Array(ciphertextBuffer)),
  };
}

export async function importRecoveryKit(
  encryptedInput: string | EncryptedRecoveryKit,
  passphrase: string,
): Promise<RecoveryKitData> {
  const pkg: EncryptedRecoveryKit =
    typeof encryptedInput === 'string' ? JSON.parse(encryptedInput) : encryptedInput;

  if (pkg.version !== 1 || !pkg.salt || !pkg.iv || !pkg.ciphertext) {
    throw new Error('Invalid recovery kit format');
  }

  const salt = hexToBytes(pkg.salt);
  const iv = hexToBytes(pkg.iv);
  const ciphertext = hexToBytes(pkg.ciphertext);

  const key = await deriveKey(passphrase, salt, pkg.iterations || 100000);

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      ciphertext as unknown as BufferSource,
    );
    const dec = new TextDecoder();
    const jsonStr = dec.decode(decryptedBuffer);
    return JSON.parse(jsonStr) as RecoveryKitData;
  } catch {
    throw new Error('Failed to decrypt recovery kit. Incorrect passphrase or corrupted file.');
  }
}
