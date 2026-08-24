import { describe, it, expect } from 'vitest';
import {
  validatePassphrase,
  generateRecoveryFilename,
  exportRecoveryKit,
  importRecoveryKit,
} from './recoveryKit';

describe('recoveryKit', () => {
  it('validates passphrase strength and blocks weak passphrases (< 8 chars)', () => {
    const weak1 = validatePassphrase('short');
    expect(weak1.valid).toBe(false);
    expect(weak1.score).toBe(0);
    expect(weak1.message).toContain('at least 8 characters');

    const weak2 = validatePassphrase('1234567');
    expect(weak2.valid).toBe(false);

    const valid = validatePassphrase('securePass123!');
    expect(valid.valid).toBe(true);
    expect(valid.score).toBeGreaterThanOrEqual(3);
  });

  it('generates filename including meta-address prefix', () => {
    const filename = generateRecoveryFilename('st:xlm:0x1234567890abcdef');
    expect(filename).toContain('wraith-recovery-kit-1234567890ab-');
    expect(filename.endsWith('.json')).toBe(true);
  });

  it('round-trips export and import encrypted kit', async () => {
    const options = {
      passphrase: 'super-secret-passphrase-123',
      chain: 'stellar',
      metaAddress: 'st:xlm:0xabcdef1234567890',
      viewingScalarHex: '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20',
      viewingPubKeyHex: '2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40',
      spendingPubKeyHex: '4142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f60',
      spendingScalarHex: '6162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f80',
      labels: {
        '0x123': { label: 'Test Payment', tags: ['vip'] },
      },
    };

    const encryptedKit = await exportRecoveryKit(options);
    expect(encryptedKit.version).toBe(1);
    expect(encryptedKit.salt).toBeDefined();
    expect(encryptedKit.iv).toBeDefined();
    expect(encryptedKit.ciphertext).toBeDefined();

    const restored = await importRecoveryKit(encryptedKit, 'super-secret-passphrase-123');
    expect(restored.chain).toBe('stellar');
    expect(restored.metaAddress).toBe('st:xlm:0xabcdef1234567890');
    expect(restored.viewingScalarHex).toBe(options.viewingScalarHex);
    expect(restored.viewingPubKeyHex).toBe(options.viewingPubKeyHex);
    expect(restored.spendingPubKeyHex).toBe(options.spendingPubKeyHex);
    expect(restored.spendingScalarHex).toBe(options.spendingScalarHex);
    expect(restored.labels).toEqual(options.labels);
  });

  it('throws error when exporting with weak passphrase (< 8 chars)', async () => {
    await expect(
      exportRecoveryKit({
        passphrase: 'weak',
        chain: 'stellar',
        metaAddress: 'st:xlm:0x123',
        viewingScalarHex: '010203',
      }),
    ).rejects.toThrow('Passphrase must be at least 8 characters long');
  });

  it('throws error when importing with wrong passphrase', async () => {
    const encryptedKit = await exportRecoveryKit({
      passphrase: 'correct-passphrase-123',
      chain: 'stellar',
      metaAddress: 'st:xlm:0x123',
      viewingScalarHex: '0102030405',
    });

    await expect(importRecoveryKit(encryptedKit, 'wrong-passphrase-456')).rejects.toThrow(
      'Failed to decrypt recovery kit',
    );
  });
});
