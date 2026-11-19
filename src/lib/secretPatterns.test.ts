import { describe, expect, it } from 'vitest';
import {
  findSecrets,
  hasSecrets,
  isCanary,
  redactSecrets,
  redactValue,
} from '@/lib/secretPatterns.mjs';

const TX_HASH = `0x${'a'.repeat(64)}`;
const EVM_ADDRESS = `0x${'b'.repeat(40)}`;
const STELLAR_PUBLIC = `G${'B'.repeat(55)}`;
const STELLAR_SECRET = `S${'A'.repeat(55)}`;

describe('secret patterns', () => {
  it('detects seeded canaries in console output', () => {
    const line = '[app] initialized WRAITH_CANARY_ABC123 for test';
    expect(isCanary(line)).toBe(true);
    expect(findSecrets(line).map((finding) => finding.id)).toContain('canary');
  });

  it('detects labeled private keys, seeds, salts, and signatures', () => {
    expect(hasSecrets(`privateKey=0x${'c'.repeat(64)}`)).toBe(true);
    expect(hasSecrets(`spendingScalar ${'d'.repeat(64)}`)).toBe(true);
    expect(hasSecrets(STELLAR_SECRET)).toBe(true);
    expect(hasSecrets(`salt: ${'e'.repeat(48)}`)).toBe(true);
    expect(hasSecrets(`signature=${'f'.repeat(160)}`)).toBe(true);
  });

  it('detects tokens and credentials embedded in URLs', () => {
    expect(hasSecrets('eyJhbGciOi.eyJzdWIiOi.x1y2z3a4b5')).toBe(true);
    expect(hasSecrets('https://user:password@example.test/rpc')).toBe(true);
    expect(hasSecrets('https://node.test/rpc?apiKey=abc123456')).toBe(true);
  });

  it('does not treat public addresses or transaction hashes as secrets', () => {
    expect(hasSecrets(`tx=${TX_HASH} to=${EVM_ADDRESS}`)).toBe(false);
    expect(hasSecrets(`account=${STELLAR_PUBLIC}`)).toBe(false);
  });

  it('distinguishes XDR signatures from base64 data embedded in other tokens', () => {
    const imageData = `iVBORw0KGgoAAAANSUhEUg${'A'.repeat(120)}I=`;
    expect(hasSecrets(`<img src="data:image/png;base64,${imageData}">`)).toBe(false);

    const xdr = `AAAA${'z'.repeat(120)}=`;
    expect(findSecrets(`signedXdr=${xdr}`).map((finding) => finding.id)).toContain(
      'signature-material',
    );
  });
});

describe('redaction', () => {
  it('preserves transaction hashes and public addresses', () => {
    const redacted = redactSecrets(`tx=${TX_HASH} to=${EVM_ADDRESS} account=${STELLAR_PUBLIC}`);
    expect(redacted).toContain(TX_HASH);
    expect(redacted).toContain(EVM_ADDRESS);
    expect(redacted).toContain(STELLAR_PUBLIC);
  });

  it('removes a deliberately logged canary and private key', () => {
    const redacted = redactSecrets(
      `privateKey=0x${'c'.repeat(64)} WRAITH_CANARY_ABC123 tx=${TX_HASH}`,
    );
    expect(redacted).not.toContain('WRAITH_CANARY_ABC123');
    expect(redacted).not.toContain('c'.repeat(64));
    expect(redacted).toContain('[REDACTED:labeled-hex-secret]');
    expect(redacted).toContain('[REDACTED:canary]');
    expect(redacted).toContain(TX_HASH);
  });

  it('redacts nested values and error stacks', () => {
    const value = {
      memo: 'WRAITH_CANARY_ABC123',
      nested: [{ signature: `0x${'f'.repeat(160)}` }],
      count: 3,
    };
    const redacted = redactValue(value);
    expect(redacted.memo).toBe('[REDACTED:canary]');
    expect(redacted.nested[0].signature).toContain('[REDACTED:signature-material]');
    expect(redacted.count).toBe(3);

    const error = new Error('WRAITH_CANARY_ABC123');
    expect(redactValue(error).message).not.toContain('WRAITH_CANARY_ABC123');
  });
});
