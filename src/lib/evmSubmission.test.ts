import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findUnresolvedChainSubmission,
  getSubmissionRecord,
  listForeignUnresolvedSubmissions,
  reconcileChainSubmission,
  reserveSubmissionOperationId,
  submitChainTransactionOnce,
  SubmissionNeedsReviewError,
  SubmissionOutcomePendingError,
  SubmissionScopeMismatchError,
} from './submissionIdempotency';
import {
  classifyEvmBroadcastError,
  createEvmSubmissionAdapter,
  evmSubmissionScope,
  resolveEvmNonce,
  type EvmStatusClient,
} from './evmSubmission';
import {
  restoreStorage,
  timeoutError,
  trackPrepare,
  useMemoryStorage,
} from './submissionTestUtils';

const CHAIN_ID = 2651420;
const ACCOUNT = '0xAbCdEf0000000000000000000000000000000001';
const OTHER_ACCOUNT = '0x0000000000000000000000000000000000000002';
const scope = evmSubmissionScope(CHAIN_ID, ACCOUNT);

interface ChainState {
  chainId: number;
  latest: number;
  pending: number;
  receipts: Map<string, 'success' | 'reverted'>;
}

function fakeClient(state: ChainState): EvmStatusClient {
  return {
    getChainId: async () => state.chainId,
    getTransactionCount: async ({ blockTag }) =>
      blockTag === 'latest' ? state.latest : state.pending,
    getTransactionReceipt: async ({ hash }) => {
      const status = state.receipts.get(hash);
      if (!status) {
        const error = new Error(`Transaction receipt with hash "${hash}" could not be found.`);
        error.name = 'TransactionReceiptNotFoundError';
        throw error;
      }
      return { status };
    },
  };
}

function freshChain(): ChainState {
  return { chainId: CHAIN_ID, latest: 7, pending: 7, receipts: new Map() };
}

function evmAttempt(
  nonce: number,
  broadcast: () => Promise<string>,
  from: string = ACCOUNT.toLowerCase(),
) {
  return { identity: { kind: 'evm' as const, chainId: CHAIN_ID, from, nonce }, broadcast };
}

async function reserve(draft = 'evm send') {
  return reserveSubmissionOperationId(JSON.stringify({ chain: 'evm', draft }));
}

beforeEach(useMemoryStorage);
afterEach(restoreStorage);

describe('EVM submission idempotency', () => {
  it('broadcasts once when the send button is clicked twice', async () => {
    const chain = freshChain();
    const adapter = createEvmSubmissionAdapter(fakeClient(chain));
    const operationId = await reserve();
    let release!: (hash: string) => void;
    const walletSend = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const { prepare, calls } = trackPrepare(() => evmAttempt(7, walletSend));

    const first = submitChainTransactionOnce({ operationId, scope, adapter, prepare });
    const second = submitChainTransactionOnce({ operationId, scope, adapter, prepare });
    await new Promise((resolve) => setTimeout(resolve, 0));
    chain.pending = 8;
    release('0xaaa');

    const [a, b] = await Promise.all([first, second]);
    expect(a).toMatchObject({ status: 'submitted', txHash: '0xaaa' });
    expect(b).toMatchObject({ status: 'submitted', txHash: '0xaaa' });
    expect(walletSend).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });

  it('never rebuilds after a timeout while the pinned nonce is pending or consumed', async () => {
    const chain = freshChain();
    const adapter = createEvmSubmissionAdapter(fakeClient(chain));
    const operationId = await reserve();
    const { prepare, calls } = trackPrepare(() =>
      evmAttempt(7, async () => {
        throw timeoutError();
      }),
    );

    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionOutcomePendingError);
    expect(getSubmissionRecord(operationId)).toMatchObject({
      status: 'submitting',
      identity: { kind: 'evm', nonce: 7 },
    });

    chain.pending = 8;
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionOutcomePendingError);

    chain.latest = 8;
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionNeedsReviewError);
    expect(calls).toHaveLength(1);
  });

  it('confirms a timed-out send once its receipt appears', async () => {
    const chain = freshChain();
    const adapter = createEvmSubmissionAdapter(fakeClient(chain));
    const operationId = await reserve();
    const { prepare, calls } = trackPrepare(() => evmAttempt(7, async () => '0xbbb'));
    await submitChainTransactionOnce({ operationId, scope, adapter, prepare });

    chain.pending = 8;
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).resolves.toMatchObject({ status: 'submitted', txHash: '0xbbb' });

    chain.latest = 8;
    chain.receipts.set('0xbbb', 'success');
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).resolves.toMatchObject({ status: 'confirmed', txHash: '0xbbb' });
    expect(calls).toHaveLength(1);
  });

  it('reports a reverted transaction as failed without retrying', async () => {
    const chain = freshChain();
    const adapter = createEvmSubmissionAdapter(fakeClient(chain));
    const operationId = await reserve();
    const { prepare, calls } = trackPrepare(() => evmAttempt(7, async () => '0xccc'));
    await submitChainTransactionOnce({ operationId, scope, adapter, prepare });

    chain.latest = 8;
    chain.pending = 8;
    chain.receipts.set('0xccc', 'reverted');
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).resolves.toMatchObject({ status: 'failed', reason: 'reverted' });
    expect(calls).toHaveLength(1);
  });

  it('rebuilds a dropped transaction only with the same pinned nonce', async () => {
    const chain = freshChain();
    const adapter = createEvmSubmissionAdapter(fakeClient(chain));
    const operationId = await reserve();
    const hashes = ['0xd01', '0xd02'];
    const { prepare, calls } = trackPrepare((context, attempt) =>
      evmAttempt(context.pinnedNonce ?? 7, async () => hashes[attempt - 1]),
    );
    await submitChainTransactionOnce({ operationId, scope, adapter, prepare });

    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).resolves.toMatchObject({ status: 'submitted', txHash: '0xd02' });
    expect(calls).toEqual([{}, { pinnedNonce: 7 }]);

    const wrongNonce = trackPrepare(() => evmAttempt(9, async () => '0xd03'));
    await reconcileChainSubmission(operationId, scope, adapter);
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare: wrongNonce.prepare }),
    ).rejects.toThrow('must reuse the nonce');
  });

  it('requires review when the nonce was replaced by another transaction', async () => {
    const chain = freshChain();
    const adapter = createEvmSubmissionAdapter(fakeClient(chain));
    const operationId = await reserve();
    const { prepare, calls } = trackPrepare(() => evmAttempt(7, async () => '0xeee'));
    await submitChainTransactionOnce({ operationId, scope, adapter, prepare });

    chain.latest = 8;
    chain.pending = 8;
    chain.receipts.set('0xspeedup', 'success');
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionNeedsReviewError);
    expect(getSubmissionRecord(operationId)).toMatchObject({
      status: 'submitted',
      resolution: 'replaced',
    });
    expect(calls).toHaveLength(1);
  });

  it('treats a stale nonce as ambiguous and refuses to reuse a consumed pin', async () => {
    expect(classifyEvmBroadcastError(new Error('nonce too low: next nonce 8, tx nonce 7'))).toBe(
      'ambiguous',
    );
    expect(classifyEvmBroadcastError(new Error('already known'))).toBe('ambiguous');

    const chain = freshChain();
    const client = fakeClient(chain);
    await expect(resolveEvmNonce(client, ACCOUNT)).resolves.toBe(7);
    await expect(resolveEvmNonce(client, ACCOUNT, 7)).resolves.toBe(7);
    chain.latest = 8;
    await expect(resolveEvmNonce(client, ACCOUNT, 7)).rejects.toBeInstanceOf(
      SubmissionNeedsReviewError,
    );

    const adapter = createEvmSubmissionAdapter(client);
    const operationId = await reserve();
    chain.latest = 7;
    const { prepare } = trackPrepare(() =>
      evmAttempt(7, async () => {
        throw new Error('nonce too low');
      }),
    );
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionOutcomePendingError);
    expect(getSubmissionRecord(operationId)?.status).toBe('submitting');
  });

  it('recovers the unresolved submission after a page refresh', async () => {
    const chain = freshChain();
    const adapter = createEvmSubmissionAdapter(fakeClient(chain));
    const operationId = await reserve('refresh');
    const { prepare } = trackPrepare(() => evmAttempt(7, async () => '0xf00'));
    await submitChainTransactionOnce({ operationId, scope, adapter, prepare });

    await expect(reserve('refresh')).resolves.toBe(operationId);
    expect(findUnresolvedChainSubmission(scope)).toMatchObject({ operationId, txHash: '0xf00' });

    chain.latest = 8;
    chain.receipts.set('0xf00', 'success');
    const { verdict } = await reconcileChainSubmission(operationId, scope, adapter);
    expect(verdict).toEqual({ state: 'confirmed', txHash: '0xf00' });
    expect(findUnresolvedChainSubmission(scope)).toBeNull();
  });

  it('never acts on a submission after an account or network switch', async () => {
    const chain = freshChain();
    const adapter = createEvmSubmissionAdapter(fakeClient(chain));
    const operationId = await reserve();
    const { prepare } = trackPrepare(() =>
      evmAttempt(7, async () => {
        throw timeoutError();
      }),
    );
    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionOutcomePendingError);

    const switchedAccount = evmSubmissionScope(CHAIN_ID, OTHER_ACCOUNT);
    const switchedNetwork = evmSubmissionScope(1, ACCOUNT);
    const other = trackPrepare(() => evmAttempt(0, async () => '0x999'));
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
    expect(listForeignUnresolvedSubmissions(switchedAccount)).toHaveLength(1);

    chain.chainId = 1;
    const { verdict } = await reconcileChainSubmission(operationId, scope, adapter);
    expect(verdict).toEqual({ state: 'unknown', reason: 'network-mismatch' });
    expect(getSubmissionRecord(operationId)?.status).toBe('submitting');

    const fresh = await reserve('mid-flow switch');
    const switchedWallet = trackPrepare(() =>
      evmAttempt(7, async () => '0x111', OTHER_ACCOUNT.toLowerCase()),
    );
    await expect(
      submitChainTransactionOnce({
        operationId: fresh,
        scope,
        adapter,
        prepare: switchedWallet.prepare,
      }),
    ).rejects.toBeInstanceOf(SubmissionScopeMismatchError);
    expect(getSubmissionRecord(fresh)?.status).toBe('prepared');
  });

  it('allows a clean retry after the wallet rejects the signature', async () => {
    const chain = freshChain();
    const adapter = createEvmSubmissionAdapter(fakeClient(chain));
    const operationId = await reserve();
    const rejection = Object.assign(new Error('User rejected the request.'), {
      name: 'UserRejectedRequestError',
      code: 4001,
    });
    const send = vi.fn().mockRejectedValueOnce(rejection).mockResolvedValueOnce('0x123');
    const { prepare, calls } = trackPrepare(() => evmAttempt(7, send));

    await expect(submitChainTransactionOnce({ operationId, scope, adapter, prepare })).rejects.toBe(
      rejection,
    );
    expect(getSubmissionRecord(operationId)).toMatchObject({
      status: 'prepared',
      resolution: 'rejected',
    });
    expect(getSubmissionRecord(operationId)?.identity).toBeUndefined();

    await expect(
      submitChainTransactionOnce({ operationId, scope, adapter, prepare }),
    ).resolves.toMatchObject({ status: 'submitted', txHash: '0x123' });
    expect(calls).toHaveLength(2);
  });
});
