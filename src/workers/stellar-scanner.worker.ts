import { scanAnnouncements, bytesToHex } from '@wraith-protocol/sdk/chains/stellar';
import type { Announcement } from '@wraith-protocol/sdk/chains/stellar';
import { Address, xdr } from '@stellar/stellar-sdk';

async function fetchAnnouncementEvents(
  rpcUrl: string,
  contractId: string,
): Promise<Announcement[]> {
  const all: Announcement[] = [];

  try {
    let startLedger = 1;
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

    if (probeData.error?.message) {
      const match = probeData.error.message.match(/range:\s*(\d+)\s*-\s*(\d+)/);
      if (match) {
        const oldest = parseInt(match[1], 10);
        const latest = parseInt(match[2], 10);
        startLedger = Math.max(oldest, latest - 5000);
      } else {
        return all;
      }
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
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'getEvents', params }),
      });

      const data = await res.json();
      const events = data.result?.events ?? [];

      for (const event of events) {
        try {
          const ann = parseAnnouncementEvent(event);
          if (ann) all.push(ann);
        } catch {
          // Skip malformed
        }
      }

      if (events.length < 1000) {
        hasMore = false;
      } else {
        cursor = data.result?.cursor;
        if (!cursor) hasMore = false;
      }
    }
  } catch {
    // Events API may not be available
  }

  return all;
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
  const { rpcUrl, announcerContract, viewingKey, spendingPubKey, spendingScalar } = e.data;

  try {
    const announcements = await fetchAnnouncementEvents(rpcUrl, announcerContract);
    const results = scanAnnouncements(announcements, viewingKey, spendingPubKey, spendingScalar);
    self.postMessage({ type: 'SUCCESS', results });
  } catch (err) {
    self.postMessage({
      type: 'ERROR',
      error: err instanceof Error ? err.message : 'Scan failed in worker',
    });
  }
};
