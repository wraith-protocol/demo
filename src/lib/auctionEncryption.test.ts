import { describe, expect, it } from 'vitest';
import {
  AUCTION_VAULT_VERSION,
  MAX_PBKDF2_ITERATIONS,
  MIN_PBKDF2_ITERATIONS,
  UnsupportedVersionError,
  createBackup,
  decrypt,
  decryptBids,
  encrypt,
  encryptBids,
  isValidVault,
  parseBackup,
  validateVault,
  type AuctionBid,
  type EncryptedBidVault,
} from '@/lib/auctionEncryption';

const passphrase = 'correct horse battery staple';
const bids: Record<string, AuctionBid> = {
  nova: {
    name: 'nova',
    amountStroops: '25000000',
    depositStroops: '25000000',
    saltHex: 'ab'.repeat(32),
    revealed: false,
  },
};

function corrupt(vault: EncryptedBidVault): EncryptedBidVault {
  const bytes = Uint8Array.from(atob(vault.data), (character) => character.charCodeAt(0));
  bytes[0] ^= 0xff;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { ...vault, data: btoa(binary) };
}

describe('auction encryption', () => {
  it('encrypts and decrypts valid recovery records', async () => {
    const vault = await encryptBids(passphrase, bids, MIN_PBKDF2_ITERATIONS);

    expect(vault.version).toBe(AUCTION_VAULT_VERSION);
    expect(await decryptBids(passphrase, vault)).toEqual(bids);
    expect(JSON.stringify(vault)).not.toContain(passphrase);
    expect(JSON.stringify(vault)).not.toContain(bids.nova.amountStroops);
    expect(JSON.stringify(vault)).not.toContain(bids.nova.depositStroops);
    expect(JSON.stringify(vault)).not.toContain(bids.nova.saltHex);
  });

  it('uses a fresh random salt and IV for every new vault', async () => {
    const first = await encryptBids(passphrase, bids, MIN_PBKDF2_ITERATIONS);
    const second = await encryptBids(passphrase, bids, MIN_PBKDF2_ITERATIONS);

    expect(first.kdf.salt).not.toBe(second.kdf.salt);
    expect(first.cipher.iv).not.toBe(second.cipher.iv);
    expect(first.data).not.toBe(second.data);
  });

  it('rejects a wrong passphrase and corrupted ciphertext', async () => {
    const vault = await encryptBids(passphrase, bids, MIN_PBKDF2_ITERATIONS);

    await expect(decryptBids('wrong passphrase', vault)).rejects.toThrow();
    await expect(decryptBids(passphrase, corrupt(vault))).rejects.toThrow();
  });

  it('rejects unsupported versions and invalid vault metadata', async () => {
    const vault = await encryptBids(passphrase, bids, MIN_PBKDF2_ITERATIONS);

    expect(() => validateVault({ ...vault, version: 2 })).toThrow(UnsupportedVersionError);
    expect(isValidVault(null)).toBe(false);
    expect(isValidVault({ version: 1 })).toBe(false);
    expect(isValidVault({ ...vault, kdf: { ...vault.kdf, iterations: 1 } })).toBe(false);
    expect(
      isValidVault({
        ...vault,
        kdf: { ...vault.kdf, iterations: MIN_PBKDF2_ITERATIONS - 1 },
      }),
    ).toBe(false);
    expect(isValidVault({ ...vault, kdf: { ...vault.kdf, iterations: 20_000_000 } })).toBe(false);
    expect(
      isValidVault({ ...vault, kdf: { ...vault.kdf, iterations: MAX_PBKDF2_ITERATIONS + 1 } }),
    ).toBe(false);
    await expect(encryptBids(passphrase, bids, MAX_PBKDF2_ITERATIONS + 1)).rejects.toThrow(
      /iteration count/i,
    );
    expect(isValidVault({ ...vault, cipher: { ...vault.cipher, iv: 'AA==' } })).toBe(false);
    expect(isValidVault({ ...vault, data: 'AA==' })).toBe(false);
  });

  it('rejects malformed bid records and malformed decrypted payloads', async () => {
    const invalidBid = {
      nova: { ...bids.nova, amountStroops: '1e8' },
    };
    await expect(encryptBids(passphrase, invalidBid, MIN_PBKDF2_ITERATIONS)).rejects.toThrow();

    const malformedPayload = await encrypt(
      passphrase,
      JSON.stringify({ nova: { ...bids.nova, saltHex: 'not-a-salt' } }),
      MIN_PBKDF2_ITERATIONS,
    );
    await expect(decryptBids(passphrase, malformedPayload)).rejects.toThrow();
    await expect(decrypt(passphrase, malformedPayload)).resolves.toContain('nova');
  });

  it('round-trips a versioned encrypted backup and rejects malformed wrappers', async () => {
    const vault = await encryptBids(passphrase, bids, MIN_PBKDF2_ITERATIONS);
    const backup = createBackup(vault);

    expect(parseBackup(backup)).toEqual(backup);
    expect(parseBackup(vault).vault).toEqual(vault);
    expect(() => parseBackup({ ...backup, version: 2 })).toThrow();
    expect(() => parseBackup({ type: backup.type, version: 1, vault })).toThrow();
  });
});
