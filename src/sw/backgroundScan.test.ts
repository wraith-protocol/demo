import { afterEach, describe, expect, it, vi } from 'vitest';
import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import {
  bytesToHex,
  deriveStealthKeys,
  generateStealthAddress,
} from '@wraith-protocol/sdk/chains/stellar';
import {
  createWrappingKey,
  openViewingMaterial,
  sealViewingMaterial,
  type StoredViewingKey,
} from '../lib/stellar/backgroundKeys';
import { runBackgroundScan, type ScanCommit, type ScanStore } from './backgroundScan';
import { mergeMatches } from './idbScanStore';

const RPC_URL = 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
const NO_BACKOFF = { baseDelayMs: 0 };

function randomSignature(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(64));
}

function buildEvent(params: {
  stealthAddress: string;
  caller: string;
  ephemeralPubKey: Uint8Array;
  viewTag: number;
  ledger?: number;
}) {
  const valueVec = [
    new Address(params.caller).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(params.ephemeralPubKey)),
    xdr.ScVal.scvBytes(Buffer.from([params.viewTag])),
  ];
  return {
    topic: [
      xdr.ScVal.scvSymbol('announce').toXDR('base64'),
      nativeToScVal(1, { type: 'u32' }).toXDR('base64'),
      new Address(params.stealthAddress).toScVal().toXDR('base64'),
    ],
    value: xdr.ScVal.scvVec(valueVec).toXDR('base64'),
    ledger: params.ledger,
  };
}

type RpcResult = { events?: unknown[]; latestLedger?: number; cursor?: string };
type RpcReply = { status?: number; result?: RpcResult; error?: { message: string } };

/** Stubs fetch with a scripted sequence of replies; the last reply repeats. */
function scriptRpc(replies: RpcReply[]) {
  const calls: Record<string, any>[] = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    calls.push(JSON.parse(init?.body as string).params);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    return new Response(JSON.stringify({ result: reply.result, error: reply.error }), {
      status: reply.status ?? 200,
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

function memoryStore(records: StoredViewingKey[], opts: { failCommit?: boolean } = {}) {
  const rows = new Map(records.map((r) => [r.publicKey, { ...r }]));
  const commits: ScanCommit[] = [];
  const store: ScanStore = {
    list: async () => [...rows.values()].map((r) => ({ ...r })),
    commit: async (publicKey, commit) => {
      if (opts.failCommit) throw new Error('disk full');
      commits.push(commit);
      const current = rows.get(publicKey);
      if (!current) return;
      rows.set(publicKey, {
        ...current,
        matches: mergeMatches(current.matches ?? [], commit.newMatches),
        lastScannedLedger: Math.max(current.lastScannedLedger ?? 0, commit.lastScannedLedger ?? 0),
      });
    },
  };
  return { store, rows, commits };
}

async function registration(publicKey: string, keys = deriveStealthKeys(randomSignature())) {
  const wrappingKey = await createWrappingKey();
  const sealed = await sealViewingMaterial(wrappingKey, keys);
  const record: StoredViewingKey = { publicKey, ...sealed, wrappingKey, timestamp: 1 };
  return { keys, wrappingKey, record };
}

function paymentTo(keys: ReturnType<typeof deriveStealthKeys>, ledger?: number) {
  const generated = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);
  const caller = generateStealthAddress(
    deriveStealthKeys(randomSignature()).spendingPubKey,
    deriveStealthKeys(randomSignature()).viewingPubKey,
  ).stealthAddress;
  return {
    generated,
    event: buildEvent({
      stealthAddress: generated.stealthAddress,
      caller,
      ephemeralPubKey: generated.ephemeralPubKey,
      viewTag: generated.viewTag,
      ledger,
    }),
  };
}

const scan = (store: ScanStore) =>
  runBackgroundScan({ store, rpcUrl: RPC_URL, contractId: CONTRACT_ID, retry: NO_BACKOFF });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('viewing key boundary', () => {
  it('round-trips sealed material through the stored record', async () => {
    const { keys, record } = await registration('GA');
    const material = await openViewingMaterial(record);
    expect(material.viewingKey).toEqual(keys.viewingKey);
    expect(material.spendingPubKey).toEqual(keys.spendingPubKey);
    expect(material.spendingScalar).toBe(keys.spendingScalar);
  });

  it('keeps the wrapping key non-extractable', async () => {
    const { wrappingKey } = await registration('GA');
    expect(wrappingKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', wrappingKey)).rejects.toThrow();
  });
});

describe('background scan', () => {
  it('persists matched payments and advances the cursor to the RPC ledger', async () => {
    const { keys, record } = await registration('GA');
    const mine = paymentTo(keys, 90);
    const other = paymentTo(deriveStealthKeys(randomSignature()), 91);
    const { calls } = scriptRpc([
      { result: { events: [mine.event, other.event], latestLedger: 120 } },
    ]);
    const { store, rows } = memoryStore([{ ...record, lastScannedLedger: 80 }]);

    const [outcome] = await scan(store);

    expect(calls[0].startLedger).toBe(80);
    expect(outcome).toMatchObject({ status: 'ok', lastScannedLedger: 120 });
    const saved = rows.get('GA')!;
    expect(saved.lastScannedLedger).toBe(120);
    expect(saved.matches).toHaveLength(1);
    expect(saved.matches![0]).toMatchObject({
      stealthAddress: mine.generated.stealthAddress,
      ephemeralPubKey: bytesToHex(mine.generated.ephemeralPubKey),
      ledger: 90,
    });
  });

  it('never persists spend material with a match', async () => {
    const { keys, record } = await registration('GA');
    scriptRpc([{ result: { events: [paymentTo(keys, 5).event], latestLedger: 6 } }]);
    const { store, rows } = memoryStore([record]);

    await scan(store);

    expect(Object.keys(rows.get('GA')!.matches![0]).sort()).toEqual([
      'caller',
      'detectedAt',
      'ephemeralPubKey',
      'ledger',
      'schemeId',
      'stealthAddress',
    ]);
  });

  it('starts from ledger 1 on the first scan', async () => {
    const { record } = await registration('GA');
    const { calls } = scriptRpc([{ result: { events: [], latestLedger: 50 } }]);
    await scan(memoryStore([record]).store);
    expect(calls[0].startLedger).toBe(1);
  });

  it('falls back to the retained ledger range when the RPC rejects the start ledger', async () => {
    const { record } = await registration('GA');
    const { calls } = scriptRpc([
      { error: { message: 'startLedger must be within the ledger range: 100 - 9000' } },
      { result: { events: [], latestLedger: 9000 } },
    ]);
    const { store, rows } = memoryStore([{ ...record, lastScannedLedger: 20 }]);

    const [outcome] = await scan(store);

    expect(calls.map((c) => c.startLedger)).toEqual([20, 100]);
    expect(outcome.status).toBe('ok');
    expect(rows.get('GA')!.lastScannedLedger).toBe(9000);
  });

  it('follows pagination cursors before moving the cursor', async () => {
    const { keys, record } = await registration('GA');
    const filler = paymentTo(deriveStealthKeys(randomSignature())).event;
    const mine = paymentTo(keys, 7);
    const { calls } = scriptRpc([
      { result: { events: Array(1000).fill(filler), cursor: 'page-2', latestLedger: 10 } },
      { result: { events: [mine.event], latestLedger: 12 } },
    ]);
    const { store, rows } = memoryStore([record]);

    await scan(store);

    expect(calls[1].pagination.cursor).toBe('page-2');
    expect(calls[1].startLedger).toBeUndefined();
    expect(rows.get('GA')!.matches).toHaveLength(1);
    expect(rows.get('GA')!.lastScannedLedger).toBe(12);
  });

  it('skips malformed events without failing the scan', async () => {
    const { keys, record } = await registration('GA');
    const mine = paymentTo(keys, 3);
    scriptRpc([
      {
        result: {
          events: [{ topic: ['not-xdr', 'x', 'y'], value: 'nope' }, { topic: [] }, mine.event],
          latestLedger: 4,
        },
      },
    ]);
    const { store, rows } = memoryStore([record]);

    const [outcome] = await scan(store);

    expect(outcome.status).toBe('ok');
    expect(rows.get('GA')!.matches).toHaveLength(1);
  });

  it('ignores registrations that hold only a push subscription', async () => {
    const { fetchMock } = scriptRpc([{ result: { events: [], latestLedger: 1 } }]);
    const pushOnly: StoredViewingKey = {
      publicKey: 'p256dh',
      encryptedViewingKey: '',
      encryptedSpendingPubKey: '',
      encryptedSpendingScalar: '',
      timestamp: 1,
    };

    expect(await scan(memoryStore([pushOnly]).store)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('duplicate events', () => {
  it('records a payment once when the RPC returns the same event twice', async () => {
    const { keys, record } = await registration('GA');
    const mine = paymentTo(keys, 30);
    scriptRpc([{ result: { events: [mine.event, mine.event], latestLedger: 31 } }]);
    const { store, rows } = memoryStore([record]);

    const [outcome] = await scan(store);

    expect(outcome).toMatchObject({ status: 'ok' });
    expect(rows.get('GA')!.matches).toHaveLength(1);
  });

  it('does not re-record a payment seen again after the inclusive cursor overlap', async () => {
    const { keys, record } = await registration('GA');
    const mine = paymentTo(keys, 30);
    scriptRpc([{ result: { events: [mine.event], latestLedger: 31 } }]);
    const { store, rows } = memoryStore([record]);

    const [first] = await scan(store);
    const [second] = await scan(store);

    expect(first.status === 'ok' && first.newMatches).toHaveLength(1);
    expect(second.status === 'ok' && second.newMatches).toHaveLength(0);
    expect(rows.get('GA')!.matches).toHaveLength(1);
  });
});

describe('retry', () => {
  it('retries transient RPC failures and then persists', async () => {
    const { keys, record } = await registration('GA');
    const mine = paymentTo(keys, 8);
    const { fetchMock } = scriptRpc([
      { status: 503 },
      { status: 429 },
      { result: { events: [mine.event], latestLedger: 9 } },
    ]);
    const { store, rows } = memoryStore([record]);

    const [outcome] = await scan(store);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(outcome.status).toBe('ok');
    expect(rows.get('GA')!.matches).toHaveLength(1);
    expect(rows.get('GA')!.lastScannedLedger).toBe(9);
  });

  it('leaves the cursor and matches untouched when retries are exhausted', async () => {
    const { record } = await registration('GA');
    scriptRpc([{ status: 503 }]);
    const { store, rows, commits } = memoryStore([{ ...record, lastScannedLedger: 40 }]);

    const [outcome] = await scan(store);

    expect(outcome.status).toBe('error');
    expect(commits).toHaveLength(0);
    expect(rows.get('GA')!.lastScannedLedger).toBe(40);
  });

  it('does not retry an RPC error response, and does not move the cursor', async () => {
    const { record } = await registration('GA');
    const { fetchMock } = scriptRpc([{ error: { message: 'invalid filters' } }]);
    const { store, rows } = memoryStore([{ ...record, lastScannedLedger: 40 }]);

    const [outcome] = await scan(store);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ status: 'error', message: 'invalid filters' });
    expect(rows.get('GA')!.lastScannedLedger).toBe(40);
  });

  it('does not advance the cursor when persisting fails, so the next run rescans', async () => {
    const { keys, record } = await registration('GA');
    scriptRpc([{ result: { events: [paymentTo(keys, 8).event], latestLedger: 9 } }]);
    const failing = memoryStore([{ ...record, lastScannedLedger: 5 }], { failCommit: true });

    const [outcome] = await scan(failing.store);
    expect(outcome).toMatchObject({ status: 'error', message: 'disk full' });
    expect(failing.rows.get('GA')!.lastScannedLedger).toBe(5);
    expect(failing.rows.get('GA')!.matches).toBeUndefined();

    const recovered = memoryStore([{ ...record, lastScannedLedger: 5 }]);
    const [retry] = await scan(recovered.store);
    expect(retry.status === 'ok' && retry.newMatches).toHaveLength(1);
  });
});

describe('key errors', () => {
  it('reports a missing wrapping key without touching the network or the cursor', async () => {
    const { record } = await registration('GA');
    const { fetchMock } = scriptRpc([{ result: { events: [], latestLedger: 1 } }]);
    const legacy = { ...record, wrappingKey: undefined, lastScannedLedger: 12 };
    const { store, commits } = memoryStore([legacy]);

    const [outcome] = await scan(store);

    expect(outcome).toMatchObject({ status: 'key-error', code: 'no-wrapping-key' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(commits).toHaveLength(0);
  });

  it('reports a wrong wrapping key as a decrypt failure', async () => {
    const { record } = await registration('GA');
    scriptRpc([{ result: { events: [], latestLedger: 1 } }]);
    const { store, commits } = memoryStore([{ ...record, wrappingKey: await createWrappingKey() }]);

    const [outcome] = await scan(store);

    expect(outcome).toMatchObject({ status: 'key-error', code: 'decrypt-failed' });
    expect(commits).toHaveLength(0);
  });

  it('reports tampered ciphertext as a decrypt failure', async () => {
    const { record } = await registration('GA');
    scriptRpc([{ result: { events: [], latestLedger: 1 } }]);
    const flipped = record.encryptedViewingKey.slice(0, -2) + '00';
    const tampered = { ...record, encryptedViewingKey: flipped };

    const [outcome] = await scan(memoryStore([tampered]).store);

    expect(outcome).toMatchObject({ status: 'key-error', code: 'decrypt-failed' });
  });

  it('reports unreadable stored fields as malformed', async () => {
    const { record } = await registration('GA');
    scriptRpc([{ result: { events: [], latestLedger: 1 } }]);
    const garbage = { ...record, encryptedSpendingScalar: 'not-hex!' };

    const [outcome] = await scan(memoryStore([garbage]).store);

    expect(outcome).toMatchObject({ status: 'key-error', code: 'malformed' });
  });

  it('does not leak key material into the error message', async () => {
    const { record } = await registration('GA');
    scriptRpc([{ result: { events: [], latestLedger: 1 } }]);
    const [outcome] = await scan(memoryStore([{ ...record, wrappingKey: undefined }]).store);
    expect(JSON.stringify(outcome)).not.toContain(record.encryptedViewingKey);
  });

  it('still scans healthy keys when another key is broken', async () => {
    const broken = await registration('GBROKEN');
    const healthy = await registration('GHEALTHY');
    scriptRpc([{ result: { events: [paymentTo(healthy.keys, 2).event], latestLedger: 3 } }]);
    const { store, rows } = memoryStore([
      { ...broken.record, wrappingKey: undefined },
      healthy.record,
    ]);

    const outcomes = await scan(store);

    expect(outcomes.map((o) => o.status)).toEqual(['key-error', 'ok']);
    expect(rows.get('GHEALTHY')!.matches).toHaveLength(1);
    expect(rows.get('GBROKEN')!.matches).toBeUndefined();
  });
});
