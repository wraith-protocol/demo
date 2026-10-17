import type { Announcement } from '@wraith-protocol/sdk/chains/stellar';
import { DEFAULT_SCAN_STRATEGY, type ScanStrategy } from '../workers/stellarScanDispatch';
import { findMatches } from '../workers/stellarScanMatch';
import {
  isScanKeyUnlocked,
  openScanKey,
  wipeScanKeyMaterial,
  type ScanKeyBackend,
} from './scanKeyStore';

/** What leaves the scanner on a match: no keys, no scalars. */
export interface BackgroundMatch {
  publicKey: string;
  stealthAddress: string;
}

export interface BackgroundScanDeps {
  backend: ScanKeyBackend;
  publicKey: string;
  loadAnnouncements: () => Promise<{ announcements: Announcement[]; latestLedger: number }>;
  notifyMatch: (match: BackgroundMatch) => Promise<void>;
  strategy?: ScanStrategy;
}

export type BackgroundScanResult =
  | { status: 'scanned'; matches: BackgroundMatch[]; nextLedger: number }
  | { status: 'locked' | 'missing' | 'invalid' };

/**
 * One background scan pass. Holds no state between calls: the key is re-opened
 * from storage every time, so lock, restart and removal all take effect at once.
 * Callers must only advance their cursor when status is 'scanned'.
 */
export async function scanWithStoredKey(deps: BackgroundScanDeps): Promise<BackgroundScanResult> {
  const opened = await openScanKey(deps.backend, deps.publicKey);
  if (opened.status !== 'ok') return { status: opened.status }; // no network when locked

  const { material } = opened;
  try {
    const { announcements, latestLedger } = await deps.loadAnnouncements();

    // The key may have been locked or removed while we were on the network.
    if (!(await isScanKeyUnlocked(deps.backend, deps.publicKey))) return { status: 'locked' };

    const found = findMatches(
      deps.strategy ?? DEFAULT_SCAN_STRATEGY,
      announcements,
      material.viewingKey,
      material.spendingPubKey,
    );
    const matches = found.map((m) => ({
      publicKey: deps.publicKey,
      stealthAddress: m.stealthAddress,
    }));
    for (const match of matches) await deps.notifyMatch(match);
    return { status: 'scanned', matches, nextLedger: latestLedger + 1 };
  } finally {
    wipeScanKeyMaterial(material);
  }
}

// ─── notification ────────────────────────────────────────────────────────────

export interface MatchNotificationOptions {
  body: string;
  icon: string;
  badge: string;
  tag: string;
  data: { id: string; stealthAddress: string; timestamp: number; url: string };
}

export interface MatchNotifier {
  showNotification(title: string, options: MatchNotificationOptions): Promise<void>;
  broadcast(message: unknown): Promise<void>;
}

export function buildMatchNotification(match: BackgroundMatch, now = Date.now()) {
  const id = `match:${match.stealthAddress}`;
  const options: MatchNotificationOptions = {
    body: 'A new stealth payment matched your account. Open Wraith to claim it.',
    icon: '/favicon-32x32.png',
    badge: '/favicon-16x16.png',
    tag: id,
    data: { id, stealthAddress: match.stealthAddress, timestamp: now, url: '/notifications' },
  };
  return { title: 'Payment received', options };
}

export async function deliverMatch(notifier: MatchNotifier, match: BackgroundMatch) {
  const { title, options } = buildMatchNotification(match);
  try {
    await notifier.showNotification(title, options);
  } catch (error) {
    console.warn('[wraith-sw] Could not show match notification:', error);
  }
  await notifier.broadcast({
    type: 'STELLAR_PAYMENT_MATCH',
    publicKey: match.publicKey,
    stealthAddress: match.stealthAddress,
  });
}
