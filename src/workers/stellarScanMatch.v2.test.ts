import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { describe, expect, it } from 'vitest';
import {
  bytesToHex,
  deriveStealthKeys,
  generateStealthAddress,
  SCHEME_ID,
} from '@wraith-protocol/sdk/chains/stellar';
import type { Announcement } from '@wraith-protocol/sdk/chains/stellar';
import type { ScanStrategy } from './stellarScanDispatch';
import { findMatches, SCHEME_ID_V2 } from './stellarScanMatch';

function randomSignature(): Uint8Array {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return bytes;
}

// Independent re-statement of the spec, so the fixture does not depend on the code under test.
function specV2Tag(ephemeralPubKey: Uint8Array, viewingPubKey: Uint8Array): number {
  const prefix = new TextEncoder().encode('wraith:stellar:view-tag:v2:');
  const input = new Uint8Array(prefix.length + ephemeralPubKey.length + viewingPubKey.length);
  input.set(prefix);
  input.set(ephemeralPubKey, prefix.length);
  input.set(viewingPubKey, prefix.length + ephemeralPubKey.length);
  return sha256(input)[0];
}

/** Scheme-2 announcement whose public tag differs from the legacy tag. */
function makeV2Announcement(spendingPubKey: Uint8Array, viewingPubKey: Uint8Array): Announcement {
  for (let attempt = 0; attempt < 20; attempt++) {
    const generated = generateStealthAddress(spendingPubKey, viewingPubKey);
    const v2Tag = specV2Tag(generated.ephemeralPubKey, viewingPubKey);
    if (v2Tag === generated.viewTag) continue;
    return {
      schemeId: SCHEME_ID_V2,
      stealthAddress: generated.stealthAddress,
      caller: 'CANNOUNCERCONTRACT',
      ephemeralPubKey: bytesToHex(generated.ephemeralPubKey),
      metadata: bytesToHex(new Uint8Array([v2Tag])),
    };
  }
  throw new Error('could not build a distinguishable scheme-2 fixture');
}

const STRATEGIES: ScanStrategy[] = ['fast', 'balanced', 'full'];

describe('findMatches: scheme 2 (v2 announcer)', () => {
  const recipient = deriveStealthKeys(randomSignature());
  const stranger = deriveStealthKeys(randomSignature());
  const mine = makeV2Announcement(recipient.spendingPubKey, recipient.viewingPubKey);
  const noise = makeV2Announcement(stranger.spendingPubKey, stranger.viewingPubKey);
  const run = (strategy: ScanStrategy, announcements: Announcement[]) =>
    findMatches(strategy, announcements, recipient.viewingKey, recipient.spendingPubKey).map(
      (m) => m.stealthAddress,
    );

  it('fixture sanity: the viewing public key is the ed25519 key of the viewing seed', () => {
    expect(ed25519.getPublicKey(recipient.viewingKey)).toEqual(recipient.viewingPubKey);
  });

  it.each(STRATEGIES)('%s finds a scheme-2 payment and ignores a stranger', (strategy) => {
    expect(run(strategy, [noise, mine])).toEqual([mine.stealthAddress]);
  });

  it('is non-vacuous: the same bytes labelled scheme 1 do not match', () => {
    const asV1: Announcement = { ...mine, schemeId: SCHEME_ID };
    expect(run('fast', [asV1])).toEqual([]);
    expect(run('balanced', [asV1])).toEqual([]);
  });

  it('rejects a wrong tag in fast/balanced; full still finds the payment', () => {
    const wrongTag: Announcement = {
      ...mine,
      metadata: bytesToHex(new Uint8Array([(parseInt(mine.metadata, 16) + 1) % 256])),
    };
    expect(run('fast', [wrongTag])).toEqual([]);
    expect(run('balanced', [wrongTag])).toEqual([]);
    expect(run('full', [wrongTag])).toEqual([mine.stealthAddress]);
  });

  it('balanced cross-checks the address; fast trusts the tag', () => {
    const spoofed: Announcement = { ...mine, stealthAddress: noise.stealthAddress };
    expect(run('fast', [spoofed])).toHaveLength(1);
    expect(run('balanced', [spoofed])).toEqual([]);
    expect(run('full', [spoofed])).toEqual([]);
  });

  it('ignores unsupported schemes', () => {
    const unknown: Announcement = { ...mine, schemeId: 3 };
    for (const strategy of STRATEGIES) expect(run(strategy, [unknown])).toEqual([]);
  });

  it('handles scheme 1 and scheme 2 announcements in one pass', () => {
    const g = generateStealthAddress(recipient.spendingPubKey, recipient.viewingPubKey);
    const v1: Announcement = {
      schemeId: SCHEME_ID,
      stealthAddress: g.stealthAddress,
      caller: 'GCALLER',
      ephemeralPubKey: bytesToHex(g.ephemeralPubKey),
      metadata: bytesToHex(new Uint8Array([g.viewTag])),
    };
    expect(run('balanced', [v1, noise, mine]).sort()).toEqual(
      [v1.stealthAddress, mine.stealthAddress].sort(),
    );
  });
});
