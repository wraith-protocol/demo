import { bytesToHex } from '@wraith-protocol/sdk/chains/stellar';
import type { Announcement } from '@wraith-protocol/sdk/chains/stellar';
import { Address, xdr } from '@stellar/stellar-sdk';
import { scanWithStrategy, DEFAULT_SCAN_STRATEGY, type ScanStrategy } from './stellarScanDispatch';
import { retentionErrorFromRpcMessage, retentionGapFromError } from '../lib/stellar/scannerCursor';

interface LedgerRange {
  oldest: number;
  latest: number;
}

interface RpcError {
  message?: unknown;
}

interface RpcResponse<T> {
  result?: T;
  error?: RpcError;
}

interface GetLatestLedgerResult {
  sequence?: unknown;
}

interface GetEventsResult {
  events?: unknown[];
  cursor?: unknown;
}

interface ScannerWorkerRequest {
  rpcUrl: string;
  announcerContract: string;
  viewingKey: Uint8Array;
  spendingPubKey: Uint8Array;
  spendingScalar: bigint;
  strategy?: ScanStrategy;
  startLedger?: number;
}

interface ScannerWorkerSuccessMessage {
  type: 'SUCCESS';
  results: ReturnType<typeof scanWithStrategy>;
  nextLedger: number;
}

interface ScannerWorkerRetentionGapMessage {
  type: 'RETENTION_GAP';
  oldestLedger: number;
  savedStartLedger: number;
}

interface ScannerWorkerErrorMessage {
  type: 'ERROR';
  error: string;
}

type ScannerWorkerResponse =
  | ScannerWorkerSuccessMessage
  | ScannerWorkerRetentionGapMessage
  | ScannerWorkerErrorMessage;

function parseLedgerRange(message: string): LedgerRange | undefined {
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
  const data = (await response.json()) as RpcResponse<GetLatestLedgerResult>;
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
  const probeData = (await probeRes.json()) as RpcResponse<GetEventsResult>;
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
    const pagination: Record<string, unknown> = { limit: 1000 };
    if (cursor) {
      pagination.cursor = cursor;
    }

    const params: Record<string, unknown> = {
      filters: [{ type: 'contract', contractIds: [contractId] }],
      pagination,
    };
    if (!cursor) {
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
    const data = (await res.json()) as RpcResponse<GetEventsResult>;
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
      const nextCursor = data.result?.cursor;
      if (typeof nextCursor === 'string' && nextCursor.length > 0) {
        cursor = nextCursor;
      } else {
        hasMore = false;
      }
    }
  }

  return { announcements: all, nextLedger: latestLedger + 1 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseAnnouncementEvent(event: unknown): Announcement | null {
  if (!isRecord(event)) return null;

  const topics = event.topic;
  if (!Array.isArray(topics) || topics.length < 3) return null;
  const schemeIdTopic = topics[1];
  const stealthTopic = topics[2];
  if (typeof schemeIdTopic !== 'string' || typeof stealthTopic !== 'string') {
    return null;
  }

  const schemeIdScVal = xdr.ScVal.fromXDR(schemeIdTopic, 'base64');
  const schemeId = schemeIdScVal.u32();

  const stealthScVal = xdr.ScVal.fromXDR(stealthTopic, 'base64');
  const stealthScAddress = stealthScVal.address();
  const stealthAddress = Address.fromScAddress(stealthScAddress).toString();

  const value = event.value;
  if (typeof value !== 'string') return null;
  const valueScVal = xdr.ScVal.fromXDR(value, 'base64');
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

interface ScannerWorkerScope {
  onmessage: ((e: MessageEvent<ScannerWorkerRequest>) => void) | null;
  postMessage: (message: ScannerWorkerResponse) => void;
}

const workerScope = self as unknown as ScannerWorkerScope;

workerScope.onmessage = async (e: MessageEvent<ScannerWorkerRequest>) => {
  const {
    rpcUrl,
    announcerContract,
    viewingKey,
    spendingPubKey,
    spendingScalar,
    strategy,
    startLedger,
  } = e.data;

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
    workerScope.postMessage({ type: 'SUCCESS', results, nextLedger });
  } catch (err) {
    const retentionGap = retentionGapFromError(err);
    if (retentionGap) {
      workerScope.postMessage({ type: 'RETENTION_GAP', ...retentionGap });
      return;
    }
    workerScope.postMessage({
      type: 'ERROR',
      error: err instanceof Error ? err.message : 'Scan failed in worker',
    });
  }
};
