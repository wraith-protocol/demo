import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  StellarRpcError,
  StellarRpcHttpError,
  StellarRpcResponseError,
  StellarRpcTimeoutError,
  fetchEventPages,
  fetchLatestLedger,
  type EventsPage,
  type StellarRpcEvent,
} from './rpcEvents';
import { StellarRetentionExceededError } from './scannerCursor';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';

type RequestBody = Record<string, any>;

function ok(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
}

function rpcError(message: string, code = -32602): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code, message } }));
}

function mockRpc(responder: (body: RequestBody) => Response | Promise<Response>): RequestBody[] {
  const requests: RequestBody[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}') as RequestBody;
      requests.push(body);
      return responder(body);
    }),
  );
  return requests;
}

function event(ledger: number): StellarRpcEvent {
  return { topic: ['AAAA', 'AAAA', 'AAAA'], value: 'AAAA', ledger };
}

function eventRange(from: number, to: number): StellarRpcEvent[] {
  const events: StellarRpcEvent[] = [];
  for (let ledger = from; ledger <= to; ledger += 1) events.push(event(ledger));
  return events;
}

/** Data requests are the ones that ask for a full page rather than probing. */
function isDataRequest(body: RequestBody): boolean {
  return body.method === 'getEvents' && body.params?.pagination?.limit !== 1;
}

function isProbe(body: RequestBody): boolean {
  return body.method === 'getEvents' && body.params?.pagination?.limit === 1;
}

function pagedResponder(options: {
  pages: StellarRpcEvent[][];
  latestLedger: number;
  /** Soroban rejects requests older than this window. */
  retentionWindow?: { oldest: number; latest: number };
  /** 1-based data page that should fail. */
  failDataPage?: { page: number; status: number };
}) {
  let dataPage = 0;
  return (body: RequestBody): Response => {
    if (body.method === 'getLatestLedger') return ok({ sequence: options.latestLedger });
    if (body.method !== 'getEvents') return ok({});

    const startLedger = body.params?.startLedger;
    if (
      options.retentionWindow &&
      typeof startLedger === 'number' &&
      startLedger < options.retentionWindow.oldest
    ) {
      return rpcError(
        `startLedger must be within the ledger range: ${options.retentionWindow.oldest} - ${options.retentionWindow.latest}`,
      );
    }

    if (isProbe(body)) return ok({ events: [], latestLedger: options.latestLedger });

    dataPage += 1;
    if (options.failDataPage && options.failDataPage.page === dataPage) {
      return new Response('upstream unavailable', { status: options.failDataPage.status });
    }

    const events = options.pages[dataPage - 1] ?? [];
    const hasMore = dataPage < options.pages.length;
    return ok({
      events,
      latestLedger: options.latestLedger,
      ...(hasMore ? { cursor: `c${dataPage}` } : {}),
    });
  };
}

describe('Stellar RPC event pagination', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows pagination past the 1,000-event page cap and commits after every page', async () => {
    const requests = mockRpc(
      pagedResponder({
        latestLedger: 3_000,
        pages: [eventRange(1, 1_000), eventRange(1_001, 2_000), eventRange(2_001, 2_500)],
      }),
    );
    const progress: EventsPage[] = [];

    const result = await fetchEventPages({
      rpcUrl: RPC_URL,
      contractId: CONTRACT_ID,
      onPage: (page) => {
        progress.push(page);
      },
    });

    expect(result.events).toHaveLength(2_500);
    expect(result.pages).toBe(3);
    expect(result.truncated).toBe(false);
    // A page boundary can split a ledger, so only ledgers below the boundary
    // ledger are committed mid-scan; the final, exhausted page commits the tip.
    expect(progress.map((page) => page.committedLedger)).toEqual([999, 1_999, 3_000]);
    expect(progress.map((page) => page.events.length)).toEqual([1_000, 1_000, 500]);

    const dataRequests = requests.filter(isDataRequest);
    expect(dataRequests[0].params.startLedger).toBe(1);
    expect(dataRequests[1].params.pagination.cursor).toBe('c1');
    expect(dataRequests[1].params.startLedger).toBeUndefined();
    expect(dataRequests[2].params.pagination.cursor).toBe('c2');
    expect(result.nextLedger).toBe(3_001);
    expect(result.committedLedger).toBe(3_000);
  });

  it('resumes from the last committed page after a mid-scan failure', async () => {
    mockRpc(
      pagedResponder({
        latestLedger: 3_000,
        pages: [eventRange(1, 1_000), eventRange(1_001, 2_000), eventRange(2_001, 2_500)],
        failDataPage: { page: 2, status: 503 },
      }),
    );
    const progress: number[] = [];

    await expect(
      fetchEventPages({
        rpcUrl: RPC_URL,
        contractId: CONTRACT_ID,
        startLedger: 1,
        onPage: (page) => {
          progress.push(page.committedLedger);
        },
      }),
    ).rejects.toBeInstanceOf(StellarRpcHttpError);

    // Only the first page was delivered, so only the first page may be committed.
    expect(progress).toEqual([999]);

    // A restart from that committed cursor must read the failed page again
    // instead of jumping to the tip.
    const resumedRequests = mockRpc(
      pagedResponder({
        latestLedger: 3_000,
        pages: [eventRange(1_001, 2_000), eventRange(2_001, 2_500)],
      }),
    );
    const resumed = await fetchEventPages({
      rpcUrl: RPC_URL,
      contractId: CONTRACT_ID,
      startLedger: progress[progress.length - 1] + 1,
    });

    const dataRequests = resumedRequests.filter(isDataRequest);
    expect(dataRequests[0].params.startLedger).toBe(1_000);
    expect(dataRequests[1].params.pagination.cursor).toBe('c1');
    expect(resumed.events).toHaveLength(1_500);
    expect(resumed.committedLedger).toBe(3_000);
    expect(dataRequests).toHaveLength(2);
  });

  it('bounds every request with an abortable timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted.', 'AbortError')),
            );
          }),
      ),
    );
    const progress: EventsPage[] = [];

    await expect(
      fetchEventPages({
        rpcUrl: RPC_URL,
        contractId: CONTRACT_ID,
        timeoutMs: 20,
        onPage: (page) => {
          progress.push(page);
        },
      }),
    ).rejects.toBeInstanceOf(StellarRpcTimeoutError);

    expect(progress).toEqual([]);
  });

  it('rejects non-2xx responses before trusting the body', async () => {
    mockRpc(() => new Response('<html>bad gateway</html>', { status: 502 }));

    await expect(
      fetchEventPages({ rpcUrl: RPC_URL, contractId: CONTRACT_ID }),
    ).rejects.toMatchObject({ name: 'StellarRpcHttpError', status: 502 });
  });

  it('validates the JSON-RPC envelope and result shape', async () => {
    mockRpc(() => new Response('<html>not json</html>'));
    await expect(
      fetchEventPages({ rpcUrl: RPC_URL, contractId: CONTRACT_ID }),
    ).rejects.toBeInstanceOf(StellarRpcResponseError);

    mockRpc(() => ok({ events: 'definitely-not-an-array' }));
    await expect(fetchEventPages({ rpcUrl: RPC_URL, contractId: CONTRACT_ID })).rejects.toThrow(
      /events was not an array/,
    );

    mockRpc(() => ok({}));
    await expect(fetchLatestLedger(RPC_URL)).rejects.toThrow(/sequence/);
  });

  it('drops malformed event entries without losing the cursor', async () => {
    mockRpc(() =>
      ok({
        events: [event(10), { value: 42 }, 'garbage', { topic: ['AAAA'] }],
        latestLedger: 20,
      }),
    );

    const result = await fetchEventPages({
      rpcUrl: RPC_URL,
      contractId: CONTRACT_ID,
      startLedger: 10,
      throughLedger: 20,
    });

    expect(result.events).toHaveLength(1);
    expect(result.malformedEvents).toBe(3);
    expect(result.nextLedger).toBe(21);
  });

  it('maps an out-of-range cursor to a retention error carrying the window', async () => {
    mockRpc(
      pagedResponder({
        latestLedger: 500,
        retentionWindow: { oldest: 250, latest: 500 },
        pages: [[]],
      }),
    );

    await expect(
      fetchEventPages({ rpcUrl: RPC_URL, contractId: CONTRACT_ID, startLedger: 100 }),
    ).rejects.toBeInstanceOf(StellarRetentionExceededError);

    await expect(
      fetchEventPages({ rpcUrl: RPC_URL, contractId: CONTRACT_ID, startLedger: 100 }),
    ).rejects.toMatchObject({ requestedLedger: 100, oldestAvailableLedger: 250 });
  });

  it('clamps a first scan to the retention window when no cursor is stored', async () => {
    const requests = mockRpc(
      pagedResponder({
        latestLedger: 500,
        retentionWindow: { oldest: 250, latest: 500 },
        pages: [[]],
      }),
    );

    const result = await fetchEventPages({ rpcUrl: RPC_URL, contractId: CONTRACT_ID });

    const dataRequests = requests.filter(isDataRequest);
    expect(dataRequests[0].params.startLedger).toBe(250);
    expect(result.nextLedger).toBe(501);
    expect(result.committedLedger).toBe(500);
  });

  it('stops at the committed boundary instead of chasing the tip', async () => {
    const requests = mockRpc(
      pagedResponder({
        latestLedger: 2_000,
        pages: [eventRange(1, 10), [event(400)], [event(501)]],
      }),
    );

    const result = await fetchEventPages({
      rpcUrl: RPC_URL,
      contractId: CONTRACT_ID,
      startLedger: 1,
      throughLedger: 500,
    });

    expect(requests.filter(isDataRequest)).toHaveLength(3);
    expect(result.committedLedger).toBe(500);
    expect(result.nextLedger).toBe(501);
    expect(result.truncated).toBe(false);
  });

  it('reports truncation instead of skipping pages when the page ceiling is hit', async () => {
    mockRpc(
      pagedResponder({
        latestLedger: 10_000,
        pages: [eventRange(1, 100), eventRange(101, 200), eventRange(201, 300)],
      }),
    );
    const progress: number[] = [];

    const result = await fetchEventPages({
      rpcUrl: RPC_URL,
      contractId: CONTRACT_ID,
      startLedger: 1,
      maxPages: 2,
      onPage: (page) => {
        progress.push(page.committedLedger);
      },
    });

    expect(result.truncated).toBe(true);
    expect(result.pages).toBe(2);
    expect(progress).toEqual([99, 199]);
    // The next scan resumes at the last ledger actually proven complete.
    expect(result.nextLedger).toBe(200);
  });

  it('does not commit a ledger whose events continue on a rejected page', async () => {
    // Both pages carry events from ledger 500: page 1 stops inside it and page 2
    // was going to deliver the rest before failing.
    mockRpc(
      pagedResponder({
        latestLedger: 505,
        pages: [
          [...eventRange(490, 499), event(500), event(500)],
          [event(500), event(500)],
        ],
        failDataPage: { page: 2, status: 503 },
      }),
    );
    const progress: EventsPage[] = [];

    await expect(
      fetchEventPages({
        rpcUrl: RPC_URL,
        contractId: CONTRACT_ID,
        startLedger: 500,
        onPage: (page) => {
          progress.push(page);
        },
      }),
    ).rejects.toBeInstanceOf(StellarRpcHttpError);

    // Ledger 500 was only partly delivered before the page failed, so it must
    // not be committed even though its events appeared on the first page.
    expect(progress).toHaveLength(1);
    expect(progress[0].events.filter((entry) => entry.ledger === 500)).toHaveLength(2);
    expect(progress[0].committedLedger).toBe(499);

    const resumedRequests = mockRpc(
      pagedResponder({
        latestLedger: 505,
        pages: [
          [event(500), event(500)],
          [event(500), event(500)],
        ],
      }),
    );
    const resumedStartLedger = progress[progress.length - 1].committedLedger + 1;
    const resumed = await fetchEventPages({
      rpcUrl: RPC_URL,
      contractId: CONTRACT_ID,
      startLedger: resumedStartLedger,
    });

    // The restart begins inside ledger 500 rather than at 501, so nothing is skipped.
    expect(resumedStartLedger).toBe(500);
    expect(resumedRequests.filter(isDataRequest)[0].params.startLedger).toBe(500);
    expect(resumed.events.filter((entry) => entry.ledger === 500)).toHaveLength(4);
    expect(resumed.committedLedger).toBe(505);
  });

  it('reads a boundary ledger to its end instead of stopping at the first page that touches it', async () => {
    mockRpc(
      pagedResponder({
        latestLedger: 500,
        pages: [[event(500), event(500)], [event(500)]],
      }),
    );
    const progress: number[] = [];

    const result = await fetchEventPages({
      rpcUrl: RPC_URL,
      contractId: CONTRACT_ID,
      startLedger: 500,
      throughLedger: 500,
      onPage: (page) => {
        progress.push(page.committedLedger);
      },
    });

    expect(result.events).toHaveLength(3);
    expect(result.pages).toBe(2);
    expect(progress).toEqual([499, 500]);
    expect(result.committedLedger).toBe(500);
    expect(result.nextLedger).toBe(501);
  });

  it('fails loudly when the RPC repeats a cursor', async () => {
    let dataPage = 0;
    mockRpc((body) => {
      if (body.method === 'getLatestLedger') return ok({ sequence: 1_000 });
      if (isProbe(body)) return ok({ events: [], latestLedger: 1_000 });
      dataPage += 1;
      return ok({ events: [event(dataPage * 10)], latestLedger: 1_000, cursor: 'stuck' });
    });

    await expect(
      fetchEventPages({ rpcUrl: RPC_URL, contractId: CONTRACT_ID, startLedger: 1 }),
    ).rejects.toThrow(/cursor did not advance/);
  });

  it('surfaces JSON-RPC errors as typed errors', async () => {
    mockRpc((body) => (isProbe(body) ? rpcError('boom', -32001) : ok({})));

    await expect(
      fetchEventPages({ rpcUrl: RPC_URL, contractId: CONTRACT_ID }),
    ).rejects.toBeInstanceOf(StellarRpcError);
  });
});
