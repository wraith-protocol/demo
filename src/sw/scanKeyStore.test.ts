import { describe, expect, it } from 'vitest';
import { deriveStealthKeys } from '@wraith-protocol/sdk/chains/stellar';
import {
  findSpendingSecretField,
  openScanKey,
  sealScanKey,
  toScanKeyMaterial,
} from './scanKeyStore';
import { MemoryScanKeyBackend } from './testing/memoryScanKeyBackend';

function randomSignature(): Uint8Array {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return bytes;
}

describe('scan key store', () => {
  it('seals exactly the viewing key and the spending public key', async () => {
    const keys = deriveStealthKeys(randomSignature());
    const backend = new MemoryScanKeyBackend();
    await sealScanKey(backend, 'GACCOUNT', toScanKeyMaterial(keys));

    const record = backend.records.get('GACCOUNT')!;
    // 2 length bytes + two keys + 16-byte GCM tag: there is no room for anything else.
    expect(record.ciphertext.length).toBe(
      2 + keys.viewingKey.length + keys.spendingPubKey.length + 16,
    );
    expect(backend.keys.get('GACCOUNT')!.extractable).toBe(false);

    const opened = await openScanKey(backend, 'GACCOUNT');
    expect(opened.status).toBe('ok');
    if (opened.status === 'ok') {
      expect(opened.material.viewingKey).toEqual(keys.viewingKey);
      expect(opened.material.spendingPubKey).toEqual(keys.spendingPubKey);
    }
  });

  it('toScanKeyMaterial drops every other field of the key bundle', () => {
    const material = toScanKeyMaterial(deriveStealthKeys(randomSignature()));
    expect(Object.keys(material).sort()).toEqual(['spendingPubKey', 'viewingKey']);
  });
});

describe('findSpendingSecretField', () => {
  it('flags spending secrets however they are named or nested', () => {
    expect(findSpendingSecretField({ type: 'X', encryptedSpendingScalar: 'aa' })).toBe(
      'encryptedSpendingScalar',
    );
    expect(findSpendingSecretField({ a: { b: [{ spendingScalar: 1n }] } })).toBe(
      'a.b.0.spendingScalar',
    );
    expect(findSpendingSecretField({ stealthPrivateScalar: 1n })).toBe('stealthPrivateScalar');
  });

  it('allows public keys and ordinary messages', () => {
    expect(
      findSpendingSecretField({
        type: 'REGISTER_VIEWING_KEY',
        publicKey: 'G...',
        spendingPubKey: new Uint8Array(32),
        encryptedSpendingPubKey: 'aa',
      }),
    ).toBeNull();
    expect(findSpendingSecretField(null)).toBeNull();
  });
});
