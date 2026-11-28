import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, type Hex, type TransactionSerialized } from 'viem';
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
  prepareEvmSend,
  resolveEvmNonce,
  signVerifiedEvmTransaction,
  submitVerifiedEvmTransaction,
  type EvmBroadcaster,
  type EvmFeeClient,
  type EvmSigner,
  type EvmSignRequest,
  type EvmStatusClient,
} from './evmSubmission';
import { IntentMismatchError } from './txIntent';
import {
  restoreStorage,
  timeoutError,
  trackPrepare,
  useMemoryStorage,
} from './submissionTestUtils';

const SIGNER = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const OTHER_SIGNER = privateKeyToAccount(`0x${'33'.repeat(32)}`);
const TO = '0x2222222222222222222222222222222222222222' as const;
const DATA = '0xdeadbeef' as const;
const GAS = 90_000n;
const MAX_FEE = 2_000_000_000n;
const PRIORITY_FEE = 1_000_000_000n;
const NONCE = 7;

function feeClient(): EvmFeeClient {
  return {
    estimateGas: vi.fn().mockResolvedValue(GAS),
    estimateFeesPerGas: vi.fn().mockResolvedValue({
      maxFeePerGas: MAX_FEE,
      maxPriorityFeePerGas: PRIORITY_FEE,
    }),
    getTransactionCount: vi.fn().mockResolvedValue(NONCE),
  };
}

async function reviewedSend() {
  return prepareEvmSend(feeClient(), {
    chainId: 2651420,
    account: SIGNER.address,
    to: TO,
    data: DATA,
    value: 10n ** 17n,
    stealthAddress: '0x3333333333333333333333333333333333333333',
  });
}

function signWith(
  account: typeof SIGNER,
  request: EvmSignRequest,
  overrides: Record<string, unknown> = {},
): Promise<TransactionSerialized> {
  const { account: _account, ...transaction } = request;
  return account.signTransaction({
    ...transaction,
    ...overrides,
  }) as Promise<TransactionSerialized>;
}

function signerReturning(serialized: TransactionSerialized): EvmSigner {
  return { signTransaction: vi.fn().mockResolvedValue(serialized) };
}

function broadcaster() {
  return { sendRawTransaction: vi.fn().mockResolvedValue(`0x${'ab'.repeat(32)}` as Hex) };
}

describe('pre-broadcast EVM verification', () => {
  it('binds gas, fee caps and nonce into the reviewed intent', async () => {
    const { intent, request } = await reviewedSend();

    expect(request.gas).toBe(GAS);
    expect(request.maxFeePerGas).toBe(MAX_FEE);
    expect(request.maxPriorityFeePerGas).toBe(PRIORITY_FEE);
    expect(request.nonce).toBe(NONCE);
    expect(intent.fee).toContain(GAS.toString());
    expect(intent.extra.maxFeePerGas).toBe(MAX_FEE.toString());
    expect(intent.extra.maxPriorityFeePerGas).toBe(PRIORITY_FEE.toString());
    expect(intent.extra.nonce).toBe(String(NONCE));
  });

  it('broadcasts only the exact signed transaction that passed verification', async () => {
    const { intent, request } = await reviewedSend();
    const serialized = await signWith(SIGNER, request);
    const sendRawTransaction = broadcaster();

    const hash = await submitVerifiedEvmTransaction(
      signerReturning(serialized),
      sendRawTransaction as EvmBroadcaster,
      intent,
      request,
    );

    expect(hash).toBe(`0x${'ab'.repeat(32)}`);
    expect(sendRawTransaction.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(sendRawTransaction.sendRawTransaction).toHaveBeenCalledWith({
      serializedTransaction: serialized,
    });
  });

  it('submits nothing when the wallet signs a tampered transaction', async () => {
    const { intent, request } = await reviewedSend();
    const tampered = await signWith(SIGNER, request, { value: 1n });
    const sendRawTransaction = broadcaster();

    await expect(
      submitVerifiedEvmTransaction(
        signerReturning(tampered),
        sendRawTransaction as EvmBroadcaster,
        intent,
        request,
      ),
    ).rejects.toBeInstanceOf(IntentMismatchError);

    expect(sendRawTransaction.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('submits nothing when the wallet signs with a different account', async () => {
    const { intent, request } = await reviewedSend();
    const tampered = await signWith(OTHER_SIGNER, request);
    const sendRawTransaction = broadcaster();

    await expect(
      submitVerifiedEvmTransaction(
        signerReturning(tampered),
        sendRawTransaction as EvmBroadcaster,
        intent,
        request,
      ),
    ).rejects.toBeInstanceOf(IntentMismatchError);

    expect(sendRawTransaction.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('submits nothing when verification is unavailable or the wallet result is unparseable', async () => {
    const { intent, request } = await reviewedSend();
    const sendRawTransaction = broadcaster();

    await expect(
      submitVerifiedEvmTransaction(
        undefined,
        sendRawTransaction as EvmBroadcaster,
        intent,
        request,
      ),
    ).rejects.toThrow(/verification is unavailable/i);

    await expect(
      submitVerifiedEvmTransaction(
        signerReturning('not-a-transaction' as TransactionSerialized),
        sendRawTransaction as EvmBroadcaster,
        intent,
        request,
      ),
    ).rejects.toBeInstanceOf(IntentMismatchError);

    expect(sendRawTransaction.sendRawTransaction).not.toHaveBeenCalled();
  });
});

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

describe('verified EVM signing with idempotent submission', () => {
  it('persists the verified signed hash before broadcast and adopts it after a timeout', async () => {
    const { intent, request } = await reviewedSend();
    const serialized = await signWith(SIGNER, request);
    const signed = await signVerifiedEvmTransaction(signerReturning(serialized), intent, request);
    expect(signed).toEqual({ serialized, hash: keccak256(serialized) });

    const verifiedScope = evmSubmissionScope(CHAIN_ID, SIGNER.address);
    const chain: ChainState = {
      chainId: CHAIN_ID,
      latest: NONCE,
      pending: NONCE + 1,
      receipts: new Map(),
    };
    const adapter = createEvmSubmissionAdapter(fakeClient(chain));
    const operationId = await reserve('verified send');
    const broadcast = vi.fn(async () => {
      throw timeoutError();
    });
    const { prepare, calls } = trackPrepare(() => ({
      identity: {
        kind: 'evm' as const,
        chainId: CHAIN_ID,
        from: verifiedScope.account,
        nonce: request.nonce,
        txHash: signed.hash,
      },
      broadcast,
    }));

    await expect(
      submitChainTransactionOnce({ operationId, scope: verifiedScope, adapter, prepare }),
    ).rejects.toBeInstanceOf(SubmissionOutcomePendingError);
    expect(getSubmissionRecord(operationId)).toMatchObject({
      status: 'submitting',
      txHash: signed.hash,
    });

    chain.latest = NONCE + 1;
    chain.receipts.set(signed.hash, 'success');
    await expect(
      submitChainTransactionOnce({ operationId, scope: verifiedScope, adapter, prepare }),
    ).resolves.toMatchObject({ status: 'confirmed', txHash: signed.hash });
    expect(broadcast).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(1);
  });

  it('never persists or broadcasts a tampered signature', async () => {
    const { intent, request } = await reviewedSend();
    const tampered = await signWith(SIGNER, request, { value: 1n });
    await expect(
      signVerifiedEvmTransaction(signerReturning(tampered), intent, request),
    ).rejects.toBeInstanceOf(IntentMismatchError);
    await expect(signVerifiedEvmTransaction(undefined, intent, request)).rejects.toThrow(
      /verification is unavailable/i,
    );
  });
});
