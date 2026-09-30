import { bytesToHex } from '@wraith-protocol/sdk/chains/stellar';
import type { Announcement } from '@wraith-protocol/sdk/chains/stellar';
import { Address, xdr } from '@stellar/stellar-sdk';
import { scanWithStrategy, DEFAULT_SCAN_STRATEGY, type ScanStrategy } from './stellarScanDispatch';
import { retentionErrorFromRpcMessage, retentionGapFromError } from '../lib/stellar/scannerCursor';
import { validateWebWorkerMessage, createMessage, type WebWorkerMessage } from '../types/messages';

function parseLedgerRange(message: string): { oldest: number; latest: number } | undefined {
  const match = message.match(/range:\s*(\d+)\s*-\s*(\d+)/i);
  if (!match) return undefined;
  return { oldest: Number(match[1]), latest: Number(match[2]) };
}

async function getLatestLedger(rpcUrl: string): Promise<number> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }),
  });
  const data = await response.json();
  const sequence = Number(data.result?.sequence);
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new Error('Stellar RPC did not return a valid latest ledger');
  }
  return sequence;
}

async function fetchAnnouncementEvents(
  rpcUrl: string,
  contractId: string,
  savedStartLedger?: number,
): Promise<{ announcements: Announcement[]; nextLedger: number }> {
  const all: Announcement[] = [];
  const probeRes = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'getEvents',
      params: {
        startLedger: 1,
        filters: [{ type: 'contract', contractIds: [contractId] }],
        pagination: { limit: 1 },
      },
    }),
  });
  const probeData = await probeRes.json();
  const ledgerWindow = probeData.error?.message
    ? parseLedgerRange(String(probeData.error.message))
    : undefined;
  const latestLedger = ledgerWindow?.latest ?? (await getLatestLedger(rpcUrl));
  const startLedger =
    savedStartLedger ?? Math.max(ledgerWindow?.oldest ?? 1, Math.max(1, latestLedger - 5000));

  if (ledgerWindow && startLedger < ledgerWindow.oldest) {
    throw retentionErrorFromRpcMessage(
      startLedger,
      `ledger range: ${ledgerWindow.oldest} - ${ledgerWindow.latest}`,
    );
  }
  if (probeData.error?.message && !ledgerWindow) {
    throw new Error(String(probeData.error.message));
  }

  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const params: Record<string, unknown> = {
      filters: [{ type: 'contract', contractIds: [contractId] }],
      pagination: { limit: 1000 },
    };

    if (cursor) {
      (params.pagination as Record<string, unknown>).cursor = cursor;
    } else {
      params.startLedger = startLedger;
    }

    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'getEvents',
        params,
      }),
    });
    const data = await res.json();
    if (data.error?.message) {
      const range = parseLedgerRange(String(data.error.message));
      if (range && startLedger < range.oldest) {
        throw retentionErrorFromRpcMessage(startLedger, String(data.error.message));
      }
      throw new Error(String(data.error.message));
    }
    const events = data.result?.events ?? [];

    for (const event of events) {
      try {
        const ann = parseAnnouncementEvent(event);
        if (ann) all.push(ann);
      } catch {
        // Skip malformed events without discarding the scan cursor.
      }
    }

    if (events.length < 1000) {
      hasMore = false;
    } else {
      cursor = data.result?.cursor;
      if (!cursor) hasMore = false;
    }
  }

  return { announcements: all, nextLedger: latestLedger + 1 };
}

function parseAnnouncementEvent(event: Record<string, unknown>): Announcement | null {
  const topics = event.topic as string[];
  if (!topics || topics.length < 3) return null;

  const schemeIdScVal = xdr.ScVal.fromXDR(topics[1], 'base64');
  const schemeId = schemeIdScVal.u32();

  const stealthScVal = xdr.ScVal.fromXDR(topics[2], 'base64');
  const stealthScAddress = stealthScVal.address();
  const stealthAddress = Address.fromScAddress(stealthScAddress).toString();

  const valueScVal = xdr.ScVal.fromXDR(event.value as string, 'base64');
  const valueVec = valueScVal.vec();
  if (!valueVec || valueVec.length < 3) return null;

  const callerScAddress = valueVec[0].address();
  const caller = Address.fromScAddress(callerScAddress).toString();

  const ephBytes = valueVec[1].bytes();
  const ephemeralPubKey = bytesToHex(new Uint8Array(ephBytes));

  const metaBytes = valueVec[2].bytes();
  const metadata = bytesToHex(new Uint8Array(metaBytes));

  return { schemeId, stealthAddress, caller, ephemeralPubKey, metadata };
}

self.onmessage = async (e: MessageEvent) => {
  // Validate incoming message
  const validation = validateWebWorkerMessage(e.data);

  if (!validation.valid) {
    console.error('[stellar-scanner.worker] Invalid message received:', validation.error);
    self.postMessage(
      createMessage<WebWorkerMessage>({
        type: 'ERROR',
        error: `Protocol error: ${validation.error}`,
      } as Omit<WebWorkerMessage, 'version'>),
    );
    return;
  }

  const message = validation.message!;

  // Only SCAN_REQUEST is expected as inbound
  if (message.type !== 'SCAN_REQUEST') {
    self.postMessage(
      createMessage<WebWorkerMessage>({
        type: 'ERROR',
        error: `Unexpected message type: ${message.type}`,
      } as Omit<WebWorkerMessage, 'version'>),
    );
    return;
  }

  const { rpcUrl, announcerContract, viewingKey, spendingPubKey, spendingScalar, strategy } =
    message;

  const startLedger = (message as any).startLedger;

  try {
    const { announcements, nextLedger } = await fetchAnnouncementEvents(
      rpcUrl,
      announcerContract,
      startLedger,
    );
    const results = scanWithStrategy(
      strategy ?? DEFAULT_SCAN_STRATEGY,
      announcements,
      viewingKey,
      spendingPubKey,
      spendingScalar,
    );
    self.postMessage(
      createMessage<WebWorkerMessage>({
        type: 'SUCCESS',
        results,
        nextLedger,
      } as any),
    );
  } catch (err) {
    const retentionGap = retentionGapFromError(err);
    if (retentionGap) {
      self.postMessage(createMessage({ type: 'RETENTION_GAP' as const, ...retentionGap }));
      return;
    }
    self.postMessage(
      createMessage<WebWorkerMessage>({
        type: 'ERROR',
        error: err instanceof Error ? err.message : 'Scan failed in worker',
      } as Omit<WebWorkerMessage, 'version'>),
    );
  }
};
