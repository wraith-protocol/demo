import { describe, expect, it } from 'vitest';
import { stripLegacySecretFields } from './accountRecords';

describe('stripLegacySecretFields', () => {
  it('removes every legacy encrypted-key field and keeps cursor state', () => {
    const { record, changed } = stripLegacySecretFields({
      publicKey: 'G1',
      encryptedViewingKey: 'aa',
      encryptedSpendingPubKey: 'bb',
      encryptedSpendingScalar: 'cc',
      lastScannedLedger: 42,
    });
    expect(changed).toBe(true);
    expect(record).toEqual({ publicKey: 'G1', lastScannedLedger: 42 });
  });

  it('reports unchanged for clean records', () => {
    expect(stripLegacySecretFields({ publicKey: 'G1' }).changed).toBe(false);
  });
});
