import type { MatchedAnnouncement } from '@wraith-protocol/sdk/chains/stellar';
import { scanWithStrategy, DEFAULT_SCAN_STRATEGY } from './stellarScanDispatch';
import { retentionGapFromError } from '../lib/stellar/scannerCursor';
import { fetchAnnouncementEvents } from '../lib/stellar/announcementRpc';
import type { StellarScannerRequest, StellarScannerMessage } from '../lib/stellar/scannerMessages';

export type { StellarScannerRequest, StellarScannerMessage } from '../lib/stellar/scannerMessages';

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
