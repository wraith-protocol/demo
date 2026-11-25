import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findUnresolvedChainSubmission,
  getSubmissionRecord,
  listForeignUnresolvedSubmissions,
  discardChainSubmission,
  reconcileChainSubmission,
  reserveSubmissionOperationId,
  submitChainTransactionOnce,
  SubmissionNeedsReviewError,
  SubmissionOutcomePendingError,
  SubmissionScopeMismatchError,
} from './submissionIdempotency';
import {
  ckbSubmissionScope,
  classifyCkbBroadcastError,
  createCkbSubmissionAdapter,
  formatOutPoint,
  parseOutPoint,
  type CkbStatusClient,
  type CkbTxStatus,
} from './ckbSubmission';
import {
  restoreStorage,
  timeoutError,
  trackPrepare,
  useMemoryStorage,
} from './submissionTestUtils';

const NETWORK = 'testnet';
const ACCOUNT = 'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq-sender';
const OTHER_ACCOUNT = 'ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsq-other';
const INPUT = formatOutPoint({ txHash: '0xfunding', index: 0 });
const scope = ckbSubmissionScope(NETWORK, ACCOUNT);

interface NodeState {
  statuses: Map<string, CkbTxStatus>;
  deadCells: Set<string>;
  rebroadcasts: string[];
}

function fakeClient(state: NodeState): CkbStatusClient {
  return {
    getTransactionStatus: async (hash) => state.statuses.get(hash),
    isCellLive: async (outPoint) => !state.deadCells.has(formatOutPoint(outPoint)),
    sendSignedTransaction: async (signedTx) => {
      state.rebroadcasts.push(signedTx);
      return 'ignored';
    },
  };
}

function freshNode(): NodeState {
  return { statuses: new Map(), deadCells: new Set(), rebroadcasts: [] };
}

function ckbAttempt(
  txHash: string,
  broadcast: () => Promise<string>,
  options: { from?: string; inputs?: string[] } = {},
) {
  return {
    identity: {
      kind: 'ckb' as const,
      network: NETWORK,
      from: options.from ?? ACCOUNT,
      txHash,
      signedTx: JSON.stringify({ hash: txHash }),
      inputs: options.inputs ?? [INPUT],
    },
    broadcast,
  };
}

async function reserve(draft = 'ckb send') {
  return reserveSubmissionOperationId(JSON.stringify({ chain: 'ckb', draft }));
}

beforeEach(useMemoryStorage);
afterEach(restoreStorage);

describe('CKB submission idempotency', () => {
  it('round-trips persisted out-points', () => {
    expect(parseOutPoint(formatOutPoint({ txHash: '0xabc', index: 3n }))).toEqual({
      txHash: '0xabc',
      index: 3,
    });
    expect(() => parseOutPoint('0xabc')).toThrow('Invalid CKB out-point');
  });

  it('broadcasts once when the send button is clicked twice', async () => {
    const node = freshNode();
    const adapter = createCkbSubmissionAdapter(fakeClient(node));
    const operationId = await reserve();
    const send = vi.fn(async () => {
      node.statuses.set('0x01', 'pending');
      return '0x01';
    });
    const { prepare, calls } = trackPrepare(() => ckbAttempt('0x01', send));

    const results = await Promise.all([
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ]);
    expect(results.map((result) => result.txHash)).toEqual(['0x01', '0x01']);
    expect(send).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });

  it('rebroadcasts identical bytes after a timeout and adopts the eventual commit', async () => {
    const node = freshNode();
    const adapter = createCkbSubmissionAdapter(fakeClient(node));
    const operationId = await reserve();
    const { prepare, calls } = trackPrepare(() =>
      ckbAttempt('0x02', async () => {
        throw timeoutError();
      }),
    );

    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionOutcomePendingError);
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionOutcomePendingError);
    expect(node.rebroadcasts).toEqual([JSON.stringify({ hash: '0x02' })]);

    node.statuses.set('0x02', 'proposed');
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionOutcomePendingError);

    node.statuses.set('0x02', 'committed');
    node.deadCells.add(INPUT);
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).resolves.toMatchObject({ status: 'confirmed', txHash: '0x02' });
    expect(calls).toHaveLength(1);
  });

  it('requires review instead of rebuilding when an input is consumed and the hash is absent', async () => {
    const node = freshNode();
    const adapter = createCkbSubmissionAdapter(fakeClient(node));
    const operationId = await reserve();
    const { prepare, calls } = trackPrepare((_context, attempt) =>
      ckbAttempt(`0x0${attempt + 2}`, async () => {
        if (attempt === 1) throw timeoutError();
        return `0x0${attempt + 2}`;
      }),
    );
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionOutcomePendingError);

    node.statuses.set('0x03', 'rejected');
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionOutcomePendingError);
    expect(calls).toHaveLength(1);

    node.deadCells.add(INPUT);
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionNeedsReviewError);
    expect(calls).toHaveLength(1);
    expect(getSubmissionRecord(operationId)).toMatchObject({
      status: 'submitting',
      txHash: '0x03',
      resolution: 'replaced',
    });
  });

  it('never double-pays when a wallet replacement already paid the recipient', async () => {
    const node = freshNode();
    const adapter = createCkbSubmissionAdapter(fakeClient(node));
    const operationId = await reserve('wallet replacement');
    const { prepare, calls } = trackPrepare((_context, attempt) =>
      ckbAttempt(`0xorig${attempt}`, async () => `0xorig${attempt}`),
    );
    await submitChainTransactionOnce({ operationId, scope, adapter, prepare });

    // The wallet re-signed the same payment under a new hash, spending the
    // same input; our tracked hash is now absent from the node.
    node.statuses.set('0xwallet-replacement', 'committed');
    node.deadCells.add(INPUT);

    const { verdict } = await reconcileChainSubmission(operationId, scope, adapter);
    expect(verdict).toEqual({
      state: 'replaced',
      reason: 'input-consumed-by-another-transaction',
    });
    for (let retry = 0; retry < 3; retry++) {
      await expect(
        submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
      ).rejects.toBeInstanceOf(SubmissionNeedsReviewError);
    }
    expect(calls).toHaveLength(1);
    expect(node.rebroadcasts).toHaveLength(0);
    expect(findUnresolvedChainSubmission(scope)).toMatchObject({
      operationId,
      resolution: 'replaced',
    });

    await discardChainSubmission(operationId, scope);
    expect(getSubmissionRecord(operationId)).toBeNull();
  });

  it('adopts a transaction that commits in the race with input consumption', async () => {
    const node = freshNode();
    const client = fakeClient(node);
    let lookups = 0;
    client.getTransactionStatus = async () => {
      lookups += 1;
      return lookups === 1 ? 'unknown' : 'committed';
    };
    node.deadCells.add(INPUT);
    const adapter = createCkbSubmissionAdapter(client);
    const operationId = await reserve();
    const { prepare, calls } = trackPrepare(() => ckbAttempt('0x05', async () => '0x05'));
    await submitChainTransactionOnce({ operationId, scope, adapter, prepare });

    lookups = 0;
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).resolves.toMatchObject({ status: 'confirmed', txHash: '0x05' });
    expect(calls).toHaveLength(1);
  });

  it('keeps stale-input broadcast errors ambiguous until reconciled', async () => {
    expect(
      classifyCkbBroadcastError(
        new Error('TransactionFailedToResolve: Resolve failed Dead(OutPoint(0xfunding, 0))'),
      ),
    ).toBe('ambiguous');
    expect(classifyCkbBroadcastError(new Error('PoolRejectedDuplicatedTransaction'))).toBe(
      'already-known',
    );
    expect(classifyCkbBroadcastError(new Error('TransactionFailedToVerify: script error'))).toBe(
      'rejected',
    );

    const node = freshNode();
    const adapter = createCkbSubmissionAdapter(fakeClient(node));
    const operationId = await reserve();
    const { prepare, calls } = trackPrepare(() =>
      ckbAttempt('0x06', async () => {
        throw new Error('TransactionFailedToResolve: Resolve failed Dead(OutPoint(0xfunding, 0))');
      }),
    );
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionOutcomePendingError);

    node.statuses.set('0x06', 'committed');
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).resolves.toMatchObject({ status: 'confirmed', txHash: '0x06' });
    expect(calls).toHaveLength(1);
  });

  it('treats a duplicated-transaction error as our own pooled transaction', async () => {
    const node = freshNode();
    const adapter = createCkbSubmissionAdapter(fakeClient(node));
    const operationId = await reserve();
    const { prepare } = trackPrepare(() =>
      ckbAttempt('0x07', async () => {
        throw new Error('PoolRejectedDuplicatedTransaction');
      }),
    );
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).resolves.toMatchObject({ status: 'submitted', txHash: '0x07' });
  });

  it('recovers the unresolved submission after a page refresh', async () => {
    const node = freshNode();
    const adapter = createCkbSubmissionAdapter(fakeClient(node));
    const operationId = await reserve('refresh');
    const { prepare } = trackPrepare(() =>
      ckbAttempt('0x08', async () => {
        throw timeoutError();
      }),
    );
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionOutcomePendingError);

    await expect(reserve('refresh')).resolves.toBe(operationId);
    expect(findUnresolvedChainSubmission(scope)).toMatchObject({ txHash: '0x08' });
    node.statuses.set('0x08', 'committed');
    const { verdict } = await reconcileChainSubmission(operationId, scope, adapter);
    expect(verdict).toEqual({ state: 'confirmed', txHash: '0x08' });
    expect(findUnresolvedChainSubmission(scope)).toBeNull();
  });

  it('never acts on a submission after an account or network switch', async () => {
    const node = freshNode();
    const adapter = createCkbSubmissionAdapter(fakeClient(node));
    const operationId = await reserve();
    const { prepare } = trackPrepare(() =>
      ckbAttempt('0x09', async () => {
        throw timeoutError();
      }),
    );
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionOutcomePendingError);

    const switchedAccount = ckbSubmissionScope(NETWORK, OTHER_ACCOUNT);
    const switchedNetwork = ckbSubmissionScope('mainnet', ACCOUNT);
    const other = trackPrepare(() => ckbAttempt('0x10', async () => '0x10'));
    await expect(
      submitChainTransactionOnce({
        operationId,
        scope: switchedAccount,
        adapter,
        prepare: other.prepare,
      }),
    ).rejects.toBeInstanceOf(SubmissionScopeMismatchError);
    await expect(
      reconcileChainSubmission(operationId, switchedNetwork, adapter),
    ).rejects.toBeInstanceOf(SubmissionScopeMismatchError);
    expect(other.calls).toHaveLength(0);
    expect(node.rebroadcasts).toHaveLength(0);
    expect(listForeignUnresolvedSubmissions(switchedAccount)).toHaveLength(1);

    const fresh = await reserve('mid-flow switch');
    const switched = trackPrepare(() =>
      ckbAttempt('0x11', async () => '0x11', { from: OTHER_ACCOUNT }),
    );
    await expect(
      submitChainTransactionOnce({ operationId: fresh, scope, adapter, prepare: switched.prepare }),
    ).rejects.toBeInstanceOf(SubmissionScopeMismatchError);
    expect(getSubmissionRecord(fresh)?.status).toBe('prepared');
  });

  it('allows a clean retry after the wallet rejects the signature', async () => {
    const node = freshNode();
    const adapter = createCkbSubmissionAdapter(fakeClient(node));
    const operationId = await reserve();
    const rejection = new Error('User rejected the signing request');
    let attempts = 0;
    const prepare = async () => {
      attempts += 1;
      if (attempts === 1) throw rejection;
      return ckbAttempt('0x12', async () => '0x12');
    };

    await expect(submitChainTransactionOnce({ operationId, scope, adapter, prepare })).rejects.toBe(
      rejection,
    );
    expect(getSubmissionRecord(operationId)).toMatchObject({ status: 'prepared' });
    expect(getSubmissionRecord(operationId)?.identity).toBeUndefined();
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).resolves.toMatchObject({ status: 'submitted', txHash: '0x12' });
  });
});
