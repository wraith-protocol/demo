import { describe, expect, it } from 'vitest';
import {
  AUCTION_VAULT_VERSION,
  decrypt,
  decryptBids,
  encrypt,
  encryptBids,
  isValidVault,
  UnsupportedVersionError,
  validateVault,
  type EncryptedBidVault,
} from '@/lib/auctionEncryption';

const PASSPHRASE = 'correct-horse-battery-staple';
const WRONG_PASSPHRASE = 'wrong-passphrase';
const ITERATIONS = 1000;

const bids: Record<
  string,
  {
    name: string;
    amountStroops: string;
    depositStroops: string;
    saltHex: string;
    revealed: boolean;
  }
> = {
  nova: {
    name: 'nova',
    amountStroops: '25000000',
    depositStroops: '25000000',
    saltHex: 'ab'.repeat(32),
    revealed: false,
  },
};

function tamperBase64(vault: EncryptedBidVault, index: number): EncryptedBidVault {
  const data = Buffer.from(vault.data, 'base64');
  data[index] ^= 0xff;
  return { ...vault, data: data.toString('base64') };
}

describe('auction encryption', () => {
  it('encrypts and decrypts bid recovery material', async () => {
    const vault = await encryptBids(PASSPHRASE, bids, ITERATIONS);
    expect(vault.version).toBe(AUCTION_VAULT_VERSION);
    expect(vault.kdf.iterations).toBe(ITERATIONS);
    expect(typeof vault.kdf.salt).toBe('string');
    expect(typeof vault.cipher.iv).toBe('string');
    expect(typeof vault.data).toBe('string');

    const decrypted = await decryptBids(PASSPHRASE, vault);
    expect(decrypted).toEqual(bids);
  });

  it('uses a fresh random salt and IV on every encryption', async () => {
    const a = await encryptBids(PASSPHRASE, bids, ITERATIONS);
    const b = await encryptBids(PASSPHRASE, bids, ITERATIONS);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.data).not.toBe(b.data);
  });

  it('rejects an incorrect passphrase', async () => {
    const vault = await encryptBids(PASSPHRASE, bids, ITERATIONS);
    await expect(decryptBids(WRONG_PASSPHRASE, vault)).rejects.toThrow();
  });

  it('detects corrupted ciphertext (authentication failure)', async () => {
    const vault = await encryptBids(PASSPHRASE, bids, ITERATIONS);
    const corrupted = tamperBase64(vault, 0);
    await expect(decryptBids(PASSPHRASE, corrupted)).rejects.toThrow();
  });

  it('detects corrupted authentication tag', async () => {
    const vault = await encryptBids(PASSPHRASE, bids, ITERATIONS);
    const data = Buffer.from(vault.data, 'base64');
    // Flip a byte in the final 16-byte GCM tag.
    data[data.length - 1] ^= 0xff;
    const tampered = { ...vault, data: data.toString('base64') };
    await expect(decryptBids(PASSPHRASE, tampered)).rejects.toThrow();
  });

  it('rejects unsupported payload versions', async () => {
    const vault = await encryptBids(PASSPHRASE, bids, ITERATIONS);
    const bad = { ...vault, version: 99 };
    expect(() => validateVault(bad)).toThrow(UnsupportedVersionError);
    expect(isValidVault(bad)).toBe(false);
  });

  it('rejects invalid vault structures before decryption', async () => {
    expect(() => validateVault(null)).toThrow();
    expect(() => validateVault({})).toThrow();
    expect(() => validateVault({ version: 1 })).toThrow();
    expect(isValidVault({ version: 1 })).toBe(false);
    expect(isValidVault(null)).toBe(false);
    expect(isValidVault(undefined)).toBe(false);
  });

  it('rejects a missing or short authentication tag', async () => {
    const vault = await encryptBids(PASSPHRASE, bids, ITERATIONS);
    const noTag = { ...vault, data: Buffer.from('aa', 'hex').toString('base64') };
    expect(() => validateVault(noTag)).toThrow();
  });

  it('never exposes the passphrase or plaintext in the vault payload', async () => {
    const vault = await encryptBids(PASSPHRASE, bids, ITERATIONS);
    const serialized = JSON.stringify(vault);
    expect(serialized).not.toContain(PASSPHRASE);
    expect(serialized).not.toContain(bids.nova.amountStroops);
    expect(serialized).not.toContain(bids.nova.saltHex);
    expect(serialized).not.toContain(bids.nova.depositStroops);
  });
});
