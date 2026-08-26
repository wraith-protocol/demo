import { describe, expect, it } from 'vitest';
import {
  bytesToHex,
  deriveStealthKeys,
  generateStealthAddress,
  SCHEME_ID,
} from '@wraith-protocol/sdk/chains/stellar';
import type { Announcement } from '@wraith-protocol/sdk/chains/stellar';
import { scanWithStrategy, type ScanStrategy } from './stellarScanDispatch';

function randomSignature(): Uint8Array {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return bytes;
}

function makeAnnouncement(
  spendingPubKey: Uint8Array,
  viewingPubKey: Uint8Array,
  overrides: Partial<Announcement> = {},
): Announcement {
  const generated = generateStealthAddress(spendingPubKey, viewingPubKey);
  return {
    schemeId: SCHEME_ID,
    stealthAddress: generated.stealthAddress,
    caller: 'GARBAGECALLERADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    ephemeralPubKey: bytesToHex(generated.ephemeralPubKey),
    metadata: bytesToHex(new Uint8Array([generated.viewTag])),
    ...overrides,
  };
}

describe('scanWithStrategy', () => {
  const recipient = deriveStealthKeys(randomSignature());
  const stranger = deriveStealthKeys(randomSignature());

  it('balanced: matches a genuine announcement and cross-checks the address', () => {
    const ann = makeAnnouncement(recipient.spendingPubKey, recipient.viewingPubKey);
    const noise = makeAnnouncement(stranger.spendingPubKey, stranger.viewingPubKey);

    const results = scanWithStrategy(
      'balanced',
      [ann, noise],
      recipient.viewingKey,
      recipient.spendingPubKey,
      recipient.spendingScalar,
    );

    expect(results).toHaveLength(1);
    expect(results[0].stealthAddress).toBe(ann.stealthAddress);
  });

  it('fast: matches on the view tag alone and rejects a corrupted address without erroring', () => {
    const ann = makeAnnouncement(recipient.spendingPubKey, recipient.viewingPubKey);

    const results = scanWithStrategy(
      'fast',
      [ann],
      recipient.viewingKey,
      recipient.spendingPubKey,
      recipient.spendingScalar,
    );

    expect(results).toHaveLength(1);
    expect(results[0].stealthAddress).toBe(ann.stealthAddress);

    // A stranger's announcement should not produce a false match just because
    // fast mode skips the address cross-check: the view tag itself still has
    // to line up with the recipient's shared secret.
    const strangerAnn = makeAnnouncement(stranger.spendingPubKey, stranger.viewingPubKey);
    const strangerResults = scanWithStrategy(
      'fast',
      [strangerAnn],
      recipient.viewingKey,
      recipient.spendingPubKey,
      recipient.spendingScalar,
    );
    expect(strangerResults).toHaveLength(0);
  });

  it('full: still finds a genuine payment even when the on-chain tag is wrong', () => {
    const ann = makeAnnouncement(recipient.spendingPubKey, recipient.viewingPubKey);
    // Corrupt the on-chain view tag byte so a tag-gated scan (fast/balanced)
    // would skip this announcement entirely.
    const corruptedTagAnn: Announcement = {
      ...ann,
      metadata: bytesToHex(new Uint8Array([(parseInt(ann.metadata, 16) + 1) % 256])),
    };

    const fastResults = scanWithStrategy(
      'fast',
      [corruptedTagAnn],
      recipient.viewingKey,
      recipient.spendingPubKey,
      recipient.spendingScalar,
    );
    expect(fastResults).toHaveLength(0);

    const fullResults = scanWithStrategy(
      'full',
      [corruptedTagAnn],
      recipient.viewingKey,
      recipient.spendingPubKey,
      recipient.spendingScalar,
    );
    expect(fullResults).toHaveLength(1);
    expect(fullResults[0].stealthAddress).toBe(ann.stealthAddress);
  });

  it('defaults to the balanced dispatch for an unrecognized strategy value', () => {
    const ann = makeAnnouncement(recipient.spendingPubKey, recipient.viewingPubKey);

    // Cast to exercise the default branch of the dispatch switch for a value
    // that shouldn't be reachable through the UI's own type-checked options.
    const results = scanWithStrategy(
      'nonsense' as ScanStrategy,
      [ann],
      recipient.viewingKey,
      recipient.spendingPubKey,
      recipient.spendingScalar,
    );

    expect(results).toHaveLength(1);
  });
});
