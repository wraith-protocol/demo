import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchEventPages } from './rpcEvents';

// Real cursor shape: the RPC's end-of-data cursor for ledger N, e.g.
// ledger 5256415 -> "0022576134814171135-4294967295" (seen on testnet).
const tip = (ledger: number) =>
  ((BigInt(ledger) << 32n) | 0xffffffffn).toString().padStart(19, '0') + '-4294967295';

type Body = { method: string; params?: { startLedger?: number } };
const ev = (ledger: number) => ({ topic: ['AAAA'], value: 'AAAA', ledger });
const page = (events: unknown[], cursor?: string, latestLedger = 5000) => ({
  result: { events, cursor, latestLedger },
});

/** Answers the ledger-window probe, then serves pages in order. */
function mockRpc(pages: unknown[]) {
  let next = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Body;
      const isProbe = body.method === 'getEvents' && body.params?.startLedger === 1;
      const json = isProbe
        ? {
            jsonrpc: '2.0',
            id: 1,
            error: {
              code: -32602,
              message: 'startLedger must be within the ledger range: 1000 - 5000',
            },
          }
        : pages[next++];
      return new Response(JSON.stringify(json));
    }),
  );
}
const scan = (onPage?: (p: { committedLedger: number }) => void) =>
  fetchEventPages({
    rpcUrl: 'https://rpc.test',
    contractId: 'CCONTRACT',
    startLedger: 4990,
    onPage,
  });

afterEach(() => vi.unstubAllGlobals());

describe('fetchEventPages at the tip of the ledger', () => {
  it('finishes when an empty page carries the end-of-data cursor', async () => {
    mockRpc([page([], tip(5000))]);
    const committed: number[] = [];
    const result = await scan((p) => committed.push(p.committedLedger));
    expect(result).toMatchObject({ pages: 1, committedLedger: 5000, nextLedger: 5001 });
    expect(committed).toEqual([5000]);
  });

  it('reads events, then finishes on the empty tip page', async () => {
    mockRpc([page([ev(4995), ev(4996)], '0000000000000000001-0000000001'), page([], tip(5000))]);
    const committed: number[] = [];
    const result = await scan((p) => committed.push(p.committedLedger));
    expect(result.events).toHaveLength(2);
    expect(result).toMatchObject({ pages: 2, committedLedger: 5000, nextLedger: 5001 });
    expect(committed).toEqual([4995, 5000]);
  });

  it('still rejects a repeated cursor on a page that returned events', async () => {
    mockRpc([page([ev(4995)], 'c1'), page([ev(4995)], 'c1')]);
    await expect(scan()).rejects.toThrow(/did not advance/);
  });

  it('still rejects an empty repeated cursor that is behind the latest ledger', async () => {
    mockRpc([page([], tip(100)), page([], tip(100))]);
    await expect(scan()).rejects.toThrow(/did not advance/);
  });
});
