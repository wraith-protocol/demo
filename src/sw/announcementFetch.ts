import type { Announcement } from '@wraith-protocol/sdk/chains/stellar';
import { parseAnnouncementEvent } from '../lib/stellar/announcementEvent';
import { retentionErrorFromRpcMessage } from '../lib/stellar/scannerCursor';

const PAGE_LIMIT = 1000;
const MAX_PAGES = 500;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function latestLedgerFromRpc(rpcUrl: string, fetchFn: typeof fetch): Promise<number> {
  const response = await fetchFn(rpcUrl, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }),
  });
  const sequence = Number((await response.json()).result?.sequence);
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new Error('Stellar RPC did not return a valid latest ledger');
  }
  return sequence;
}

/** Fetches every announcement from startLedger, following RPC pagination. */
export async function fetchAnnouncements(
  rpcUrl: string,
  contractId: string,
  startLedger: number,
  fetchFn: typeof fetch = fetch,
): Promise<{ announcements: Announcement[]; latestLedger: number }> {
  const announcements: Announcement[] = [];
  let cursor: string | undefined;
  let latestLedger = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const pagination: Record<string, unknown> = { limit: PAGE_LIMIT };
    const params: Record<string, unknown> = {
      filters: [{ type: 'contract', contractIds: [contractId] }],
      pagination,
    };
    if (cursor) pagination.cursor = cursor;
    else params.startLedger = startLedger;

    const response = await fetchFn(rpcUrl, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'getEvents', params }),
    });
    const data = await response.json();
    if (data.error?.message) {
      const message = String(data.error.message);
      throw retentionErrorFromRpcMessage(startLedger, message) ?? new Error(message);
    }

    const events: Record<string, unknown>[] = data.result?.events ?? [];
    for (const event of events) {
      try {
        const announcement = parseAnnouncementEvent(event);
        if (announcement) announcements.push(announcement);
      } catch {
        // Skip malformed events without losing the scan cursor.
      }
    }

    const reported = Number(data.result?.latestLedger);
    if (Number.isSafeInteger(reported) && reported > 0) latestLedger = reported;

    cursor = data.result?.cursor;
    if (events.length < PAGE_LIMIT || !cursor) {
      if (latestLedger === 0) latestLedger = await latestLedgerFromRpc(rpcUrl, fetchFn);
      return { announcements, latestLedger };
    }
  }
  throw new Error('Too many announcement pages; scan stopped without advancing the cursor');
}
