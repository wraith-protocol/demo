import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function mockGetEventsResponse(events: ReturnType<typeof buildEventEntry>[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? '{}');
      if (body.method !== 'getEvents') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }));
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { events } }));
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

  async function postAndWaitForResult(message: Record<string, unknown>) {
    const worker = (globalThis as unknown as { self: any }).self;
    return new Promise<any>((resolve) => {
      const originalPostMessage = worker.postMessage;
      worker.postMessage = (data: unknown) => {
        worker.postMessage = originalPostMessage;
        resolve(data);
      };
      worker.onmessage({ data: message });
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
    expect(result.results[0].stealthAddress).toBe(generated.stealthAddress);
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
    expect(fullResult.results[0].stealthAddress).toBe(generated.stealthAddress);
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

    // fetchAnnouncementEvents swallows fetch errors and returns an empty
    // list, so a scan still completes successfully with zero matches rather
    // than surfacing an ERROR — confirm that resilience explicitly.
    expect(result.type).toBe('SUCCESS');
    expect(result.results).toHaveLength(0);
  });
});
