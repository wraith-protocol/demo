import { describe, expect, it } from 'vitest';
import {
  bytesToHex,
  deriveStealthKeys,
  generateStealthAddress,
  SCHEME_ID,
} from '@wraith-protocol/sdk/chains/stellar';
import type { Announcement } from '@wraith-protocol/sdk/chains/stellar';
import { scanWithStrategy, type ScanStrategy } from './stellarScanDispatch';
import { findMatches } from './stellarScanMatch';

function randomSignature(): Uint8Array {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return bytes;
}

function makeAnnouncement(spendingPubKey: Uint8Array, viewingPubKey: Uint8Array): Announcement {
  const generated = generateStealthAddress(spendingPubKey, viewingPubKey);
  return {
    schemeId: SCHEME_ID,
    stealthAddress: generated.stealthAddress,
    caller: 'GARBAGECALLERADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    ephemeralPubKey: bytesToHex(generated.ephemeralPubKey),
    metadata: bytesToHex(new Uint8Array([generated.viewTag])),
  };
}

describe('findMatches', () => {
  const recipient = deriveStealthKeys(randomSignature());
  const stranger = deriveStealthKeys(randomSignature());
  const mine = makeAnnouncement(recipient.spendingPubKey, recipient.viewingPubKey);
  const noise = makeAnnouncement(stranger.spendingPubKey, stranger.viewingPubKey);

  it.each(['fast', 'balanced', 'full'] as ScanStrategy[])(
    '%s finds the same payments as scanWithStrategy',
    (strategy) => {
      const expected = scanWithStrategy(
        strategy,
        [noise, mine],
        recipient.viewingKey,
        recipient.spendingPubKey,
        recipient.spendingScalar,
      ).map((m) => m.stealthAddress);
      const actual = findMatches(
        strategy,
        [noise, mine],
        recipient.viewingKey,
        recipient.spendingPubKey,
      ).map((m) => m.stealthAddress);

      expect(actual).toEqual(expected);
      expect(actual).toEqual([mine.stealthAddress]);
    },
  );

  it('full still finds a payment with a corrupted tag; fast and balanced skip it', () => {
    const corrupted: Announcement = {
      ...mine,
      metadata: bytesToHex(new Uint8Array([(parseInt(mine.metadata, 16) + 1) % 256])),
    };
    const run = (s: ScanStrategy) =>
      findMatches(s, [corrupted], recipient.viewingKey, recipient.spendingPubKey);

    expect(run('fast')).toHaveLength(0);
    expect(run('balanced')).toHaveLength(0);
    expect(run('full')).toHaveLength(1);
  });

  it('never carries a private scalar', () => {
    const matches = findMatches('balanced', [mine], recipient.viewingKey, recipient.spendingPubKey);
    expect(Object.keys(matches[0]).sort()).toEqual(['announcement', 'stealthAddress']);
    expect(() => JSON.stringify(matches)).not.toThrow(); // a bigint scalar would throw here
  });

  it('skips malformed announcements instead of throwing', () => {
    const bad: Announcement = { ...mine, ephemeralPubKey: 'not-hex' };
    expect(findMatches('balanced', [bad], recipient.viewingKey, recipient.spendingPubKey)).toEqual(
      [],
    );
  });
});
