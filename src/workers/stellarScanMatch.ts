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

/** A detected payment. Deliberately has no private scalar: claiming happens on the main thread. */
export interface AnnouncementMatch {
  announcement: Announcement;
  stealthAddress: string;
}

/**
 * Same strategies as scanWithStrategy, but needs only the viewing key and the
 * spending PUBLIC key, so it can run where spend authority must never exist.
 */
export function findMatches(
  strategy: ScanStrategy,
  announcements: Announcement[],
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
): AnnouncementMatch[] {
  const matches: AnnouncementMatch[] = [];

  for (const announcement of announcements) {
    try {
      if (announcement.schemeId !== SCHEME_ID) continue;
      const ephPubKey = hexToBytes(announcement.ephemeralPubKey);
      if (ephPubKey.length !== 32) continue;

      if (strategy === 'full') {
        const hashScalar = hashToScalar(computeSharedSecret(viewingKey, ephPubKey));
        const stealthPubKey = deriveStealthPubKey(spendingPubKey, hashScalar);
        if (pubKeyToStellarAddress(stealthPubKey) === announcement.stealthAddress) {
          matches.push({ announcement, stealthAddress: announcement.stealthAddress });
        }
        continue;
      }

      const metadata = hexToBytes(announcement.metadata);
      if (metadata.length === 0) continue;
      const result = checkStealthAddress(ephPubKey, viewingKey, spendingPubKey, metadata[0]);
      if (!result.isMatch || result.stealthPubKeyBytes === null) continue;

      // balanced (and any unknown value) also cross-checks the derived address
      if (
        strategy !== 'fast' &&
        pubKeyToStellarAddress(result.stealthPubKeyBytes) !== announcement.stealthAddress
      ) {
        continue;
      }
      matches.push({ announcement, stealthAddress: announcement.stealthAddress });
    } catch {
      // A malformed announcement must not abort the whole background scan.
    }
  }

  return matches;
}
