import { describe, expect, it } from 'vitest';
import { createStellarQrUri, isCameraUnavailableError, parseStellarQrPayload } from '@/utils/qr';

const META_ADDRESS =
  'st:xlm:5a1922b5614eed2ef72ebad40abc5d014f7c27b6e1de5dc36976e9eec4cbe29e6b912a495f9f14513d54a00a7887f986d394a30a77239475caf211e8094b6cdb';

describe('Stellar QR payloads', () => {
  it('round-trips a receive meta-address through a stellar URI', () => {
    const uri = createStellarQrUri(META_ADDRESS);

    expect(uri).toMatch(/^stellar:pay\?/);
    expect(parseStellarQrPayload(uri)).toEqual({ metaAddress: META_ADDRESS });
  });

  it('accepts a raw meta-address', () => {
    expect(parseStellarQrPayload(META_ADDRESS)).toEqual({ metaAddress: META_ADDRESS });
  });

  it('reads optional payment fields and common recipient parameter names', () => {
    const uri = `stellar:pay?destination=${encodeURIComponent(META_ADDRESS)}&amount=12.5&memo=Invoice`;

    expect(parseStellarQrPayload(uri)).toEqual({
      metaAddress: META_ADDRESS,
      amount: '12.5',
      memo: 'Invoice',
    });
  });

  it('preserves support for browser payment links', () => {
    const link = `https://example.test/pay?to=${encodeURIComponent(META_ADDRESS)}&amount=4`;

    expect(parseStellarQrPayload(link)).toEqual({
      metaAddress: META_ADDRESS,
      amount: '4',
    });
  });

  it('rejects unrelated QR content', () => {
    expect(() => parseStellarQrPayload('https://example.test/no-recipient')).toThrow(
      /meta-address/i,
    );
    expect(() => parseStellarQrPayload('not a payment')).toThrow(/supported stellar/i);
  });

  it('recognizes denied camera permission without treating scan misses as denial', () => {
    const denied = new DOMException('Permission denied', 'NotAllowedError');
    const scanMiss = new Error('No QR code found');
    scanMiss.name = 'NotFoundException';

    expect(isCameraUnavailableError(denied)).toBe(true);
    expect(isCameraUnavailableError(scanMiss)).toBe(false);
  });
});
