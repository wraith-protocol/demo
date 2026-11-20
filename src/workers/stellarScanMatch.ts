import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import {
  checkStealthAddress,
  computeSharedSecret,
  deriveStealthPubKey,
  hashToScalar,
  hexToBytes,
  pubKeyToStellarAddress,
  SCHEME_ID,
} from '@wraith-protocol/sdk/chains/stellar';
import type { Announcement } from '@wraith-protocol/sdk/chains/stellar';
import type { ScanStrategy } from './stellarScanDispatch';

/** Scheme id of the v2 announcer (SDK source: src/chains/stellar/constants.ts). */
export const SCHEME_ID_V2 = 2;

const V2_VIEW_TAG_PREFIX = new TextEncoder().encode('wraith:stellar:view-tag:v2:');

/**
 * v2 view tag, derived from public announcement data only:
 *   SHA-256("wraith:stellar:view-tag:v2:" || R_ephemeral || V_recipient)[0]
 * Mirrors computeAnnouncementViewTag in the SDK source; the released 1.4.5
 * package does not export it.
 */
export function computeV2ViewTag(ephemeralPubKey: Uint8Array, viewingPubKey: Uint8Array): number {
  const input = new Uint8Array(
    V2_VIEW_TAG_PREFIX.length + ephemeralPubKey.length + viewingPubKey.length,
  );
  input.set(V2_VIEW_TAG_PREFIX);
  input.set(ephemeralPubKey, V2_VIEW_TAG_PREFIX.length);
  input.set(viewingPubKey, V2_VIEW_TAG_PREFIX.length + ephemeralPubKey.length);
  return sha256(input)[0];
}

/** A detected payment. Deliberately has no private scalar: claiming happens on the main thread. */
export interface AnnouncementMatch {
  announcement: Announcement;
  stealthAddress: string;
}

function deriveStealthAddress(
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  ephPubKey: Uint8Array,
): string {
  const hashScalar = hashToScalar(computeSharedSecret(viewingKey, ephPubKey));
  return pubKeyToStellarAddress(deriveStealthPubKey(spendingPubKey, hashScalar));
}

/**
 * Same strategies as scanWithStrategy, for schemes 1 and 2, but needs only the
 * viewing key and the spending PUBLIC key, so it can run where spend authority
 * must never exist.
 *
 * - scheme 1: legacy shared-secret view tag (what released SDK 1.4.5 emits)
 * - scheme 2: public view tag from computeV2ViewTag
 */
export function findMatches(
  strategy: ScanStrategy,
  announcements: Announcement[],
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
): AnnouncementMatch[] {
  const matches: AnnouncementMatch[] = [];
  const found = (announcement: Announcement) =>
    matches.push({ announcement, stealthAddress: announcement.stealthAddress });

  // Computed up front so an unusable viewing key fails the scan loudly instead of
  // silently reporting zero matches.
  const viewingPubKey = announcements.some((a) => a.schemeId === SCHEME_ID_V2)
    ? ed25519.getPublicKey(viewingKey)
    : undefined;

  for (const announcement of announcements) {
    try {
      const isV2 = announcement.schemeId === SCHEME_ID_V2;
      if (announcement.schemeId !== SCHEME_ID && !isV2) continue;

      const ephPubKey = hexToBytes(announcement.ephemeralPubKey);
      if (ephPubKey.length !== 32) continue;

      if (strategy === 'full') {
        const address = deriveStealthAddress(viewingKey, spendingPubKey, ephPubKey);
        if (address === announcement.stealthAddress) found(announcement);
        continue;
      }

      const metadata = hexToBytes(announcement.metadata);
      if (metadata.length === 0) continue;
      const viewTag = metadata[0];

      if (isV2) {
        if (!viewingPubKey || computeV2ViewTag(ephPubKey, viewingPubKey) !== viewTag) continue;
        // balanced (and any unknown value) also cross-checks the derived address
        if (
          strategy !== 'fast' &&
          deriveStealthAddress(viewingKey, spendingPubKey, ephPubKey) !==
            announcement.stealthAddress
        ) {
          continue;
        }
        found(announcement);
        continue;
      }

      const result = checkStealthAddress(ephPubKey, viewingKey, spendingPubKey, viewTag);
      if (!result.isMatch || result.stealthPubKeyBytes === null) continue;
      if (
        strategy !== 'fast' &&
        pubKeyToStellarAddress(result.stealthPubKeyBytes) !== announcement.stealthAddress
      ) {
        continue;
      }
      found(announcement);
    } catch {
      // A malformed announcement must not abort the whole background scan.
    }
  }

  return matches;
}
