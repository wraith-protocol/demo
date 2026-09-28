import { listViewingKeys, updateViewingKey, type StoredMatch } from '../lib/stellar/backgroundKeys';
import type { ScanStore } from './backgroundScan';

export function mergeMatches(existing: StoredMatch[], incoming: StoredMatch[]): StoredMatch[] {
  const merged = [...existing];
  const known = new Set(existing.map((m) => `${m.stealthAddress}:${m.ephemeralPubKey}`));
  for (const match of incoming) {
    const key = `${match.stealthAddress}:${match.ephemeralPubKey}`;
    if (known.has(key)) continue;
    known.add(key);
    merged.push(match);
  }
  return merged;
}

export const idbScanStore: ScanStore = {
  list: listViewingKeys,

  commit: (publicKey, { lastScannedLedger, newMatches }) =>
    updateViewingKey(publicKey, (current) => {
      // Unregistered while the scan ran: don't resurrect the record.
      if (!current) return null;
      return {
        ...current,
        matches: mergeMatches(current.matches ?? [], newMatches),
        lastScannedLedger:
          Math.max(current.lastScannedLedger ?? 0, lastScannedLedger ?? 0) || undefined,
        timestamp: Date.now(),
      };
    }),
};
