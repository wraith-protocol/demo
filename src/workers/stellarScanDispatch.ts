import {
  checkStealthAddress,
  computeSharedSecret,
  deriveStealthPubKey,
  hashToScalar,
  hexToBytes,
  pubKeyToStellarAddress,
  scanAnnouncements,
  SCHEME_ID,
  L,
} from '@wraith-protocol/sdk/chains/stellar';
import type { Announcement, MatchedAnnouncement } from '@wraith-protocol/sdk/chains/stellar';

/**
 * The three scanning strategies exposed in Settings > Scanning strategy.
 *
 * - fast:     Trust the view-tag match alone. Skips the extra address
 *             cross-check `scanAnnouncements` performs, so it does less
 *             work per announcement but can't recover a payment whose
 *             on-chain tag doesn't match (or catch a tag collision).
 * - balanced: Default. Uses the view tag to cheaply skip non-matches,
 *             then confirms every candidate by deriving the full stealth
 *             address and comparing it to the announcement. Mirrors the
 *             SDK's `scanAnnouncements`.
 * - full:     Ignores the announced view tag completely and derives the
 *             full stealth address for every announcement, so a wrong or
 *             tampered tag can never hide a real payment. Slowest, most
 *             thorough — for auditors who don't want to rely on the tag.
 */
export type ScanStrategy = 'fast' | 'balanced' | 'full';

export const SCAN_STRATEGIES: ScanStrategy[] = ['fast', 'balanced', 'full'];
export const DEFAULT_SCAN_STRATEGY: ScanStrategy = 'balanced';

function toMatched(
  ann: Announcement,
  stealthPubKeyBytes: Uint8Array,
  hashScalar: bigint,
  spendingScalar: bigint,
): MatchedAnnouncement {
  const stealthPrivateScalar = (spendingScalar + hashScalar) % L;
  return { ...ann, stealthPrivateScalar, stealthPubKeyBytes };
}

/** Fast: view-tag match only, no address cross-check. */
function scanFast(
  announcements: Announcement[],
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  spendingScalar: bigint,
): MatchedAnnouncement[] {
  const matched: MatchedAnnouncement[] = [];

  for (const ann of announcements) {
    if (ann.schemeId !== SCHEME_ID) continue;

    const metadataBytes = hexToBytes(ann.metadata);
    if (metadataBytes.length === 0) continue;
    const viewTag = metadataBytes[0];

    const ephPubKey = hexToBytes(ann.ephemeralPubKey);
    if (ephPubKey.length !== 32) continue;

    const result = checkStealthAddress(ephPubKey, viewingKey, spendingPubKey, viewTag);
    if (result.isMatch && result.hashScalar !== null && result.stealthPubKeyBytes !== null) {
      matched.push(toMatched(ann, result.stealthPubKeyBytes, result.hashScalar, spendingScalar));
    }
  }

  return matched;
}

/** Full: ignore the announced tag, derive and confirm every announcement. */
function scanFull(
  announcements: Announcement[],
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  spendingScalar: bigint,
): MatchedAnnouncement[] {
  const matched: MatchedAnnouncement[] = [];

  for (const ann of announcements) {
    if (ann.schemeId !== SCHEME_ID) continue;

    const ephPubKey = hexToBytes(ann.ephemeralPubKey);
    if (ephPubKey.length !== 32) continue;

    const sharedSecret = computeSharedSecret(viewingKey, ephPubKey);
    const hashScalar = hashToScalar(sharedSecret);
    const stealthPubKeyBytes = deriveStealthPubKey(spendingPubKey, hashScalar);
    const stealthAddress = pubKeyToStellarAddress(stealthPubKeyBytes);

    if (stealthAddress === ann.stealthAddress) {
      matched.push(toMatched(ann, stealthPubKeyBytes, hashScalar, spendingScalar));
    }
  }

  return matched;
}

/** Dispatches to the scanning strategy selected in Settings. */
export function scanWithStrategy(
  strategy: ScanStrategy,
  announcements: Announcement[],
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  spendingScalar: bigint,
): MatchedAnnouncement[] {
  switch (strategy) {
    case 'fast':
      return scanFast(announcements, viewingKey, spendingPubKey, spendingScalar);
    case 'full':
      return scanFull(announcements, viewingKey, spendingPubKey, spendingScalar);
    case 'balanced':
    default:
      return scanAnnouncements(announcements, viewingKey, spendingPubKey, spendingScalar);
  }
}
