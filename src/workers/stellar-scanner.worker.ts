import type { MatchedAnnouncement } from '@wraith-protocol/sdk/chains/stellar';
import { scanWithStrategy, DEFAULT_SCAN_STRATEGY, type ScanStrategy } from './stellarScanDispatch';
import { retentionGapFromError } from '../lib/stellar/scannerCursor';
import { fetchAnnouncementEvents } from '../lib/stellar/announcementRpc';

export interface StellarScannerRequest {
  rpcUrl: string;
  announcerContract: string;
  viewingKey: Uint8Array;
  spendingPubKey: Uint8Array;
  spendingScalar: bigint;
  strategy?: ScanStrategy;
  startLedger?: number;
  /** Page size override; the default is the RPC's 1,000-event cap. */
  pageLimit?: number;
}

/**
 * Messages the worker posts back to the page.
 *
 * `PAGE` is emitted once per processed page, before that page's progress is
 * persisted, so an interrupted scan resumes from the first ledger it has not
 * delivered rather than from the tip. `SUCCESS` follows with the aggregate.
 */
export type StellarScannerMessage =
  | {
      type: 'PAGE';
      page: number;
      committedLedger: number;
      events: number;
      undecodableEvents: number;
      matched: MatchedAnnouncement[];
    }
  | {
      type: 'SUCCESS';
      results: MatchedAnnouncement[];
      nextLedger: number;
      committedLedger: number;
      pages: number;
      truncated: boolean;
    }
  | { type: 'RETENTION_GAP'; requestedLedger: number; oldestAvailableLedger: number }
  | { type: 'ERROR'; error: string };

function postMessage(message: StellarScannerMessage): void {
  self.postMessage(message);
}

self.onmessage = async (e: MessageEvent) => {
  const {
    rpcUrl,
    announcerContract,
    viewingKey,
    spendingPubKey,
    spendingScalar,
    strategy,
    startLedger,
    pageLimit,
  }: StellarScannerRequest = e.data;

  try {
    const scanStrategy = strategy ?? DEFAULT_SCAN_STRATEGY;
    const results: MatchedAnnouncement[] = [];

    const { nextLedger, committedLedger, pages, truncated } = await fetchAnnouncementEvents({
      rpcUrl,
      contractId: announcerContract,
      startLedger,
      pageLimit,
      onPage: (page) => {
        const matched = scanWithStrategy(
          scanStrategy,
          page.announcements,
          viewingKey,
          spendingPubKey,
          spendingScalar,
        );
        results.push(...matched);
        postMessage({
          type: 'PAGE',
          page: page.page,
          committedLedger: page.committedLedger,
          events: page.announcements.length,
          undecodableEvents: page.undecodableEvents,
          matched,
        });
      },
    });

    postMessage({
      type: 'SUCCESS',
      results,
      nextLedger,
      committedLedger,
      pages,
      truncated,
    });
  } catch (err) {
    const retentionGap = retentionGapFromError(err);
    if (retentionGap) {
      postMessage({ type: 'RETENTION_GAP', ...retentionGap });
      return;
    }
    postMessage({
      type: 'ERROR',
      error: err instanceof Error ? err.message : 'Scan failed in worker',
    });
  }
};
