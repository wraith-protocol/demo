import { afterEach, describe, expect, it, vi } from 'vitest';
import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { deriveStealthKeys, generateStealthAddress } from '@wraith-protocol/sdk/chains/stellar';

// stellar-scanner.worker.ts assigns handlers onto the Web Worker global
// (`self`). Node doesn't define `self`, so alias it to globalThis before the
// module is imported — this lets us exercise the *real* self.onmessage /
// self.postMessage contract the browser Worker would use, not a re-implementation
// of it.
(globalThis as unknown as { self: typeof globalThis }).self = globalThis;

const RPC_URL = 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';

interface WorkerMessage {
  type: string;
  [key: string]: unknown;
}

function randomSignature(): Uint8Array {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** Builds a single JSON-RPC `getEvents` announcement entry, mirroring e2e/fixtures.ts. */
function buildEventEntry(params: {
  schemeId: number;
  stealthAddress: string;
  caller: string;
  ephemeralPubKey: Uint8Array;
  viewTag: number;
}) {
  const schemeIdScVal = nativeToScVal(params.schemeId, { type: 'u32' });
  const stealthScVal = new Address(params.stealthAddress).toScVal();
  const valueVec = [
    new Address(params.caller).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(params.ephemeralPubKey)),
    xdr.ScVal.scvBytes(Buffer.from([params.viewTag])),
  ];
  const valueScVal = xdr.ScVal.scvVec(valueVec);

  return {
    topic: [
      xdr.ScVal.scvSymbol('announce').toXDR('base64'),
      schemeIdScVal.toXDR('base64'),
      stealthScVal.toXDR('base64'),
    ],
    value: valueScVal.toXDR('base64'),
    contractId: CONTRACT_ID,
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, ...(payload as object) }));
}

function mockGetEventsResponse(events: ReturnType<typeof buildEventEntry>[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}');
      if (body.method === 'getLatestLedger') {
        return jsonResponse({ result: { sequence: 500 } });
      }
      if (body.method !== 'getEvents') {
        return jsonResponse({ result: {} });
      }
      return jsonResponse({ result: { events } });
    }),
  );
}

/**
 * Serves `getEvents` the way Soroban RPC does: a probe request (limit 1), then
 * one response per page, each carrying the cursor for the next page.
 */
function mockPagedGetEvents(options: {
  pages: ReturnType<typeof buildEventEntry>[][];
  latestLedger?: number;
  /** 1-based data-page index that should fail with the given status. */
  failPage?: { page: number; status: number };
  requests?: Record<string, any>[];
}) {
  const latestLedger = options.latestLedger ?? 5_000;
  let dataPage = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}');
      options.requests?.push(body);

      if (body.method === 'getLatestLedger') {
        return jsonResponse({ result: { sequence: latestLedger } });
      }
      if (body.method !== 'getEvents') {
        return jsonResponse({ result: {} });
      }
      if (body.params?.pagination?.limit === 1) {
        // Retention probe: the whole history is inside the window.
        return jsonResponse({ result: { events: [], latestLedger } });
      }

      dataPage += 1;
      if (options.failPage && options.failPage.page === dataPage) {
        return new Response('upstream unavailable', { status: options.failPage.status });
      }

      const events = options.pages[dataPage - 1] ?? [];
      const hasMore = dataPage < options.pages.length;
      return jsonResponse({
        result: {
          events,
          latestLedger,
          ...(hasMore ? { cursor: `cursor-${dataPage}` } : {}),
        },
      });
    }),
  );
}

describe('stellar-scanner worker message contract', () => {
  const caller = generateStealthAddress(
    deriveStealthKeys(randomSignature()).spendingPubKey,
    deriveStealthKeys(randomSignature()).viewingPubKey,
  ).stealthAddress;
  const recipient = deriveStealthKeys(randomSignature());

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /**
   * Posts a scan request and collects every message until the worker reports a
   * terminal one (SUCCESS / ERROR / RETENTION_GAP). PAGE messages arrive first.
   */
  async function runScan(
    message: Record<string, unknown>,
  ): Promise<{ messages: WorkerMessage[]; terminal: WorkerMessage }> {
    const worker = (globalThis as unknown as { self: any }).self;
    return new Promise((resolve) => {
      const messages: WorkerMessage[] = [];
      const originalPostMessage = worker.postMessage;
      worker.postMessage = (data: WorkerMessage) => {
        messages.push(data);
        if (['SUCCESS', 'ERROR', 'RETENTION_GAP'].includes(data?.type)) {
          worker.postMessage = originalPostMessage;
          resolve({ messages, terminal: data });
        }
      };
      worker.onmessage({ data: message });
    });
  }

  async function postAndWaitForResult(message: Record<string, unknown>) {
    const { terminal } = await runScan(message);
    return terminal;
  }

  function validEvent() {
    const other = deriveStealthKeys(randomSignature());
    const generated = generateStealthAddress(other.spendingPubKey, other.viewingPubKey);
    return buildEventEntry({
      schemeId: 1,
      stealthAddress: generated.stealthAddress,
      caller,
      ephemeralPubKey: generated.ephemeralPubKey,
      viewTag: generated.viewTag,
    });
  }

  it('fast strategy: dispatches through the real onmessage handler and finds a genuine payment', async () => {
    await import('./stellar-scanner.worker');

    const generated = generateStealthAddress(recipient.spendingPubKey, recipient.viewingPubKey);
    mockGetEventsResponse([
      buildEventEntry({
        schemeId: 1,
        stealthAddress: generated.stealthAddress,
        caller,
        ephemeralPubKey: generated.ephemeralPubKey,
        viewTag: generated.viewTag,
      }),
    ]);

    const result = await postAndWaitForResult({
      rpcUrl: RPC_URL,
      announcerContract: CONTRACT_ID,
      viewingKey: recipient.viewingKey,
      spendingPubKey: recipient.spendingPubKey,
      spendingScalar: recipient.spendingScalar,
      strategy: 'fast',
    });

    expect(result.type).toBe('SUCCESS');
    expect(result.results).toHaveLength(1);
    expect((result.results as any)[0].stealthAddress).toBe(generated.stealthAddress);
  });

  it('balanced strategy (default, no strategy field) matches the SDK default behavior', async () => {
    await import('./stellar-scanner.worker');

    const generated = generateStealthAddress(recipient.spendingPubKey, recipient.viewingPubKey);
    mockGetEventsResponse([
      buildEventEntry({
        schemeId: 1,
        stealthAddress: generated.stealthAddress,
        caller,
        ephemeralPubKey: generated.ephemeralPubKey,
        viewTag: generated.viewTag,
      }),
    ]);

    const result = await postAndWaitForResult({
      rpcUrl: RPC_URL,
      announcerContract: CONTRACT_ID,
      viewingKey: recipient.viewingKey,
      spendingPubKey: recipient.spendingPubKey,
      spendingScalar: recipient.spendingScalar,
      // strategy omitted on purpose: worker must fall back to DEFAULT_SCAN_STRATEGY
    });

    expect(result.type).toBe('SUCCESS');
    expect(result.results).toHaveLength(1);
  });

  it('full strategy: still recovers a payment whose on-chain tag byte is wrong', async () => {
    await import('./stellar-scanner.worker');

    const generated = generateStealthAddress(recipient.spendingPubKey, recipient.viewingPubKey);
    mockGetEventsResponse([
      buildEventEntry({
        schemeId: 1,
        stealthAddress: generated.stealthAddress,
        caller,
        ephemeralPubKey: generated.ephemeralPubKey,
        viewTag: (generated.viewTag + 1) % 256, // corrupted tag
      }),
    ]);

    const fastResult = await postAndWaitForResult({
      rpcUrl: RPC_URL,
      announcerContract: CONTRACT_ID,
      viewingKey: recipient.viewingKey,
      spendingPubKey: recipient.spendingPubKey,
      spendingScalar: recipient.spendingScalar,
      strategy: 'fast',
    });
    expect(fastResult.results).toHaveLength(0);

    mockGetEventsResponse([
      buildEventEntry({
        schemeId: 1,
        stealthAddress: generated.stealthAddress,
        caller,
        ephemeralPubKey: generated.ephemeralPubKey,
        viewTag: (generated.viewTag + 1) % 256,
      }),
    ]);

    const fullResult = await postAndWaitForResult({
      rpcUrl: RPC_URL,
      announcerContract: CONTRACT_ID,
      viewingKey: recipient.viewingKey,
      spendingPubKey: recipient.spendingPubKey,
      spendingScalar: recipient.spendingScalar,
      strategy: 'full',
    });

    expect(fullResult.type).toBe('SUCCESS');
    expect(fullResult.results).toHaveLength(1);
    expect((fullResult.results as any)[0].stealthAddress).toBe(generated.stealthAddress);
  });

  it('posts an ERROR message if the RPC call throws unexpectedly', async () => {
    await import('./stellar-scanner.worker');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const result = await postAndWaitForResult({
      rpcUrl: RPC_URL,
      announcerContract: CONTRACT_ID,
      viewingKey: recipient.viewingKey,
      spendingPubKey: recipient.spendingPubKey,
      spendingScalar: recipient.spendingScalar,
      strategy: 'balanced',
    });

    expect(result.type).toBe('ERROR');
    expect(result.error).toBe('network down');
  });

  it('reports an expired cursor and only advances it after an explicit recovery scan', async () => {
    await import('./stellar-scanner.worker');
    const requestedStartLedgers: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse((init?.body as string) ?? '{}');
        if (body.method === 'getLatestLedger') {
          return jsonResponse({ result: { sequence: 500 } });
        }

        const startLedger = body.params?.startLedger;
        if (startLedger === 1) {
          return jsonResponse({
            error: { message: 'startLedger must be within the ledger range: 250 - 500' },
          });
        }
        requestedStartLedgers.push(startLedger);
        return jsonResponse({ result: { events: [] } });
      }),
    );

    const message = {
      rpcUrl: RPC_URL,
      announcerContract: CONTRACT_ID,
      viewingKey: recipient.viewingKey,
      spendingPubKey: recipient.spendingPubKey,
      spendingScalar: recipient.spendingScalar,
      strategy: 'balanced',
    };
    const expired = await postAndWaitForResult({ ...message, startLedger: 100 });

    expect(expired).toEqual({
      type: 'RETENTION_GAP',
      requestedLedger: 100,
      oldestAvailableLedger: 250,
    });
    expect(requestedStartLedgers).toEqual([]);

    const recovered = await postAndWaitForResult({ ...message, startLedger: 250 });
    expect(recovered).toMatchObject({ type: 'SUCCESS', results: [], nextLedger: 501 });
    expect(requestedStartLedgers).toEqual([250]);
  });

  it('paginates past the 1,000-event page cap and reports progress for every page', async () => {
    await import('./stellar-scanner.worker');
    const requests: Record<string, any>[] = [];
    const generated = generateStealthAddress(recipient.spendingPubKey, recipient.viewingPubKey);
    const filler = validEvent();

    mockPagedGetEvents({
      latestLedger: 5_000,
      requests,
      pages: [
        Array.from({ length: 1_000 }, () => ({ ...filler, ledger: 100 })),
        [
          {
            ...buildEventEntry({
              schemeId: 1,
              stealthAddress: generated.stealthAddress,
              caller,
              ephemeralPubKey: generated.ephemeralPubKey,
              viewTag: generated.viewTag,
            }),
            ledger: 120,
          },
        ],
      ],
    });

    const { messages, terminal } = await runScan({
      rpcUrl: RPC_URL,
      announcerContract: CONTRACT_ID,
      viewingKey: recipient.viewingKey,
      spendingPubKey: recipient.spendingPubKey,
      spendingScalar: recipient.spendingScalar,
      strategy: 'balanced',
    });

    const pages = messages.filter((message) => message.type === 'PAGE');
    expect(pages).toHaveLength(2);
    // All 1,000 events share ledger 100 and the page still has a cursor, so the
    // ledger could continue on the next page and may not be committed yet.
    expect(pages[0]).toMatchObject({ page: 1, events: 1_000, committedLedger: 99 });
    // The second page is only reachable by following the RPC cursor.
    const dataRequests = requests.filter(
      (request) => request.method === 'getEvents' && request.params?.pagination?.limit !== 1,
    );
    expect(dataRequests[0].params.startLedger).toBe(1);
    expect(dataRequests[1].params.pagination.cursor).toBe('cursor-1');

    expect(terminal.type).toBe('SUCCESS');
    expect(terminal.results).toHaveLength(1);
    expect((terminal.results as any)[0].stealthAddress).toBe(generated.stealthAddress);
  });

  it('keeps the committed cursor when a later page fails so the rescan resumes there', async () => {
    await import('./stellar-scanner.worker');
    const requests: Record<string, any>[] = [];
    const generated = generateStealthAddress(recipient.spendingPubKey, recipient.viewingPubKey);

    const pages = [
      Array.from({ length: 3 }, () => ({ ...validEvent(), ledger: 1_100 })),
      [
        {
          ...buildEventEntry({
            schemeId: 1,
            stealthAddress: generated.stealthAddress,
            caller,
            ephemeralPubKey: generated.ephemeralPubKey,
            viewTag: generated.viewTag,
          }),
          ledger: 1_200,
        },
      ],
    ];

    mockPagedGetEvents({
      latestLedger: 5_000,
      requests,
      pages,
      failPage: { page: 2, status: 503 },
    });
    const { messages: failedMessages, terminal: failed } = await runScan({
      rpcUrl: RPC_URL,
      announcerContract: CONTRACT_ID,
      viewingKey: recipient.viewingKey,
      spendingPubKey: recipient.spendingPubKey,
      spendingScalar: recipient.spendingScalar,
      strategy: 'balanced',
      startLedger: 1_000,
    });

    expect(failed.type).toBe('ERROR');

    // The first page stopped inside ledger 1,100, so its remaining events stay
    // uncommitted and the persisted cursor points back at that ledger.
    const firstPage = failedMessages.find((message) => message.type === 'PAGE');
    expect(firstPage).toMatchObject({ page: 1, committedLedger: 1_099 });
    const persistedStartLedger = Number(firstPage?.committedLedger) + 1;
    expect(persistedStartLedger).toBe(1_100);

    // Rescan from the cursor the page persisted: the failed page must still be
    // read, and nothing after it may be skipped.
    mockPagedGetEvents({ latestLedger: 5_000, requests, pages: [pages[1]] });
    const resumed = await postAndWaitForResult({
      rpcUrl: RPC_URL,
      announcerContract: CONTRACT_ID,
      viewingKey: recipient.viewingKey,
      spendingPubKey: recipient.spendingPubKey,
      spendingScalar: recipient.spendingScalar,
      strategy: 'balanced',
      startLedger: persistedStartLedger,
    });

    const resumedDataRequests = requests.filter(
      (request) => request.method === 'getEvents' && request.params?.pagination?.limit !== 1,
    );
    expect(resumedDataRequests[resumedDataRequests.length - 1].params.startLedger).toBe(1_100);
    expect(resumed.type).toBe('SUCCESS');
    expect(resumed.results).toHaveLength(1);
  });
});
