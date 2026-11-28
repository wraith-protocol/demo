import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findUnresolvedChainSubmission,
  getSubmissionRecord,
  listForeignUnresolvedSubmissions,
  reconcileChainSubmission,
  reserveSubmissionOperationId,
  submitChainTransactionOnce,
  SubmissionOutcomePendingError,
  SubmissionScopeMismatchError,
} from './submissionIdempotency';
import {
  classifySolanaBroadcastError,
  createSolanaSubmissionAdapter,
  decodeSignedTransaction,
  encodeSignedTransaction,
  solanaSubmissionScope,
  type SolanaStatusClient,
} from './solanaSubmission';
import {
  restoreStorage,
  timeoutError,
  trackPrepare,
  useMemoryStorage,
} from './submissionTestUtils';

const CLUSTER = 'devnet';
const PAYER = 'Payer1111111111111111111111111111111111111';
const OTHER_PAYER = 'Other1111111111111111111111111111111111111';
const scope = solanaSubmissionScope(CLUSTER, PAYER);

type Status = { err: unknown; confirmationStatus: 'processed' | 'confirmed' | 'finalized' };

interface ClusterState {
  finalizedHeight: number;
  statuses: Map<string, Status>;
  rawBroadcasts: Uint8Array[];
}

function fakeClient(state: ClusterState): SolanaStatusClient {
  return {
    getSignatureStatuses: async (signatures) => ({
      value: signatures.map((signature) => state.statuses.get(signature) ?? null),
    }),
    getBlockHeight: async () => state.finalizedHeight,
    sendRawTransaction: async (raw) => {
      state.rawBroadcasts.push(raw);
      return 'ignored';
    },
  };
}

function freshCluster(): ClusterState {
  return { finalizedHeight: 1_000, statuses: new Map(), rawBroadcasts: [] };
}

function solanaAttempt(
  signature: string,
  broadcast: () => Promise<string>,
  options: { lastValidBlockHeight?: number; from?: string; cluster?: string } = {},
) {
  return {
    identity: {
      kind: 'solana' as const,
      cluster: options.cluster ?? CLUSTER,
      from: options.from ?? PAYER,
      signature,
      blockhash: `hash-${signature}`,
      lastValidBlockHeight: options.lastValidBlockHeight ?? 1_150,
      signedTx: encodeSignedTransaction(new TextEncoder().encode(`signed:${signature}`)),
    },
    broadcast,
  };
}

async function reserve(draft = 'solana send') {
  return reserveSubmissionOperationId(JSON.stringify({ chain: 'solana', draft }));
}

beforeEach(useMemoryStorage);
afterEach(restoreStorage);

describe('Solana submission idempotency', () => {
  it('round-trips the persisted signed transaction bytes', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    expect(decodeSignedTransaction(encodeSignedTransaction(bytes))).toEqual(bytes);
  });

  it('broadcasts once when the send button is clicked twice', async () => {
    const cluster = freshCluster();
    const adapter = createSolanaSubmissionAdapter(fakeClient(cluster));
    const operationId = await reserve();
    const send = vi.fn(async () => 'sig-1');
    const { prepare, calls } = trackPrepare(() => solanaAttempt('sig-1', send));

    const results = await Promise.all([
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ]);
    expect(results.map((result) => result.txHash)).toEqual(['sig-1', 'sig-1']);
    expect(send).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });

  it('rebroadcasts identical bytes after a timeout and adopts the eventual success', async () => {
    const cluster = freshCluster();
    const adapter = createSolanaSubmissionAdapter(fakeClient(cluster));
    const operationId = await reserve();
    const { prepare, calls } = trackPrepare(() =>
      solanaAttempt('sig-2', async () => {
        throw timeoutError();
      }),
    );

    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionOutcomePendingError);
    expect(getSubmissionRecord(operationId)).toMatchObject({
      status: 'submitting',
      txHash: 'sig-2',
    });

    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionOutcomePendingError);
    expect(new TextDecoder().decode(cluster.rawBroadcasts[0])).toBe('signed:sig-2');

    cluster.statuses.set('sig-2', { err: null, confirmationStatus: 'confirmed' });
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).resolves.toMatchObject({ status: 'confirmed', txHash: 'sig-2' });
    expect(calls).toHaveLength(1);
  });

  it('rebuilds only after the blockhash has expired without the signature landing', async () => {
    const cluster = freshCluster();
    const adapter = createSolanaSubmissionAdapter(fakeClient(cluster));
    const operationId = await reserve();
    const { prepare, calls } = trackPrepare((_context, attempt) =>
      solanaAttempt(`sig-exp-${attempt}`, async () => {
        if (attempt === 1) throw timeoutError();
        return `sig-exp-${attempt}`;
      }),
    );
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionOutcomePendingError);

    cluster.finalizedHeight = 1_150;
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionOutcomePendingError);
    expect(calls).toHaveLength(1);

    cluster.finalizedHeight = 1_151;
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).resolves.toMatchObject({ status: 'submitted', txHash: 'sig-exp-2' });
    expect(calls).toHaveLength(2);
  });

  it('adopts a signature that lands in the race with blockhash expiry', async () => {
    const state = freshCluster();
    const client = fakeClient(state);
    let lookups = 0;
    client.getSignatureStatuses = async () => {
      lookups += 1;
      return {
        value: [lookups === 1 ? null : { err: null, confirmationStatus: 'finalized' as const }],
      };
    };
    state.finalizedHeight = 2_000;
    const adapter = createSolanaSubmissionAdapter(client);
    const operationId = await reserve();
    const { prepare, calls } = trackPrepare(() =>
      solanaAttempt('sig-race', async () => 'sig-race'),
    );
    await submitChainTransactionOnce({ operationId, scope, adapter, prepare });

    lookups = 0;
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).resolves.toMatchObject({ status: 'confirmed', txHash: 'sig-race' });
    expect(calls).toHaveLength(1);
  });

  it('reports an on-chain execution error as failed without retrying', async () => {
    const cluster = freshCluster();
    const adapter = createSolanaSubmissionAdapter(fakeClient(cluster));
    const operationId = await reserve();
    const { prepare, calls } = trackPrepare(() => solanaAttempt('sig-err', async () => 'sig-err'));
    await submitChainTransactionOnce({ operationId, scope, adapter, prepare });

    cluster.statuses.set('sig-err', {
      err: { InstructionError: [0, 'Custom'] },
      confirmationStatus: 'finalized',
    });
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).resolves.toMatchObject({ status: 'failed', reason: 'execution-error' });
    expect(calls).toHaveLength(1);
  });

  it('rebuilds with a fresh blockhash when the RPC rejects a stale one', async () => {
    expect(classifySolanaBroadcastError(new Error('Blockhash not found'))).toBe('rejected');
    expect(
      classifySolanaBroadcastError(new Error('This transaction has already been processed')),
    ).toBe('already-known');
    expect(classifySolanaBroadcastError(new Error('fetch failed'))).toBe('ambiguous');

    const cluster = freshCluster();
    const adapter = createSolanaSubmissionAdapter(fakeClient(cluster));
    const operationId = await reserve();
    const { prepare, calls } = trackPrepare((_context, attempt) =>
      solanaAttempt(`sig-stale-${attempt}`, async () => {
        if (attempt === 1) throw new Error('Transaction simulation failed: Blockhash not found');
        return `sig-stale-${attempt}`;
      }),
    );

    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toThrow('Blockhash not found');
    expect(getSubmissionRecord(operationId)).toMatchObject({ status: 'prepared' });
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).resolves.toMatchObject({ status: 'submitted', txHash: 'sig-stale-2' });
    expect(calls).toHaveLength(2);
  });

  it('treats "already processed" as our own landed signature', async () => {
    const cluster = freshCluster();
    const adapter = createSolanaSubmissionAdapter(fakeClient(cluster));
    const operationId = await reserve();
    const { prepare } = trackPrepare(() =>
      solanaAttempt('sig-dup', async () => {
        throw new Error('This transaction has already been processed');
      }),
    );
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).resolves.toMatchObject({ status: 'submitted', txHash: 'sig-dup' });
  });

  it('recovers the unresolved submission after a page refresh', async () => {
    const cluster = freshCluster();
    const adapter = createSolanaSubmissionAdapter(fakeClient(cluster));
    const operationId = await reserve('refresh');
    const { prepare } = trackPrepare(() =>
      solanaAttempt('sig-refresh', async () => {
        throw timeoutError();
      }),
    );
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionOutcomePendingError);

    await expect(reserve('refresh')).resolves.toBe(operationId);
    expect(findUnresolvedChainSubmission(scope)).toMatchObject({ txHash: 'sig-refresh' });
    cluster.statuses.set('sig-refresh', { err: null, confirmationStatus: 'finalized' });
    const { verdict } = await reconcileChainSubmission(operationId, scope, adapter);
    expect(verdict).toEqual({ state: 'confirmed', txHash: 'sig-refresh' });
    expect(findUnresolvedChainSubmission(scope)).toBeNull();
  });

  it('never acts on a submission after an account or cluster switch', async () => {
    const cluster = freshCluster();
    const adapter = createSolanaSubmissionAdapter(fakeClient(cluster));
    const operationId = await reserve();
    const { prepare } = trackPrepare(() =>
      solanaAttempt('sig-switch', async () => {
        throw timeoutError();
      }),
    );
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionOutcomePendingError);

    const switchedAccount = solanaSubmissionScope(CLUSTER, OTHER_PAYER);
    const switchedCluster = solanaSubmissionScope('mainnet-beta', PAYER);
    const other = trackPrepare(() => solanaAttempt('sig-other', async () => 'sig-other'));
    await expect(
      submitChainTransactionOnce({
        operationId,
        scope: switchedAccount,
        adapter,
        prepare: other.prepare,
      }),
    ).rejects.toBeInstanceOf(SubmissionScopeMismatchError);
    await expect(
      reconcileChainSubmission(operationId, switchedCluster, adapter),
    ).rejects.toBeInstanceOf(SubmissionScopeMismatchError);
    expect(other.calls).toHaveLength(0);
    expect(cluster.rawBroadcasts).toHaveLength(0);
    expect(listForeignUnresolvedSubmissions(switchedCluster)).toHaveLength(1);

    const fresh = await reserve('mid-flow switch');
    const switched = trackPrepare(() =>
      solanaAttempt('sig-wrong-wallet', async () => 'sig-wrong-wallet', { from: OTHER_PAYER }),
    );
    await expect(
      submitChainTransactionOnce({ operationId: fresh, scope, adapter, prepare: switched.prepare }),
    ).rejects.toBeInstanceOf(SubmissionScopeMismatchError);
    expect(getSubmissionRecord(fresh)?.status).toBe('prepared');
  });

  it('allows a clean retry after the wallet rejects the signature', async () => {
    const cluster = freshCluster();
    const adapter = createSolanaSubmissionAdapter(fakeClient(cluster));
    const operationId = await reserve();
    const rejection = Object.assign(new Error('User rejected the request.'), {
      name: 'WalletSignTransactionError',
    });
    let attempts = 0;
    const prepare = async () => {
      attempts += 1;
      if (attempts === 1) throw rejection;
      return solanaAttempt('sig-after-reject', async () => 'sig-after-reject');
    };

    await expect(submitChainTransactionOnce({ operationId, scope, adapter, prepare })).rejects.toBe(
      rejection,
    );
    expect(getSubmissionRecord(operationId)).toMatchObject({ status: 'prepared' });
    expect(getSubmissionRecord(operationId)?.identity).toBeUndefined();
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).resolves.toMatchObject({ status: 'submitted', txHash: 'sig-after-reject' });
  });
});
