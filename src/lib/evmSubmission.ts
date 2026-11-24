import type {
  BroadcastErrorClass,
  ChainSubmissionAdapter,
  ChainTxIdentity,
  ReconcileVerdict,
  SubmissionScope,
} from './submissionIdempotency';
import { SubmissionNeedsReviewError } from './submissionIdempotency';

export type EvmTxIdentity = Extract<ChainTxIdentity, { kind: 'evm' }>;

/** Minimal read-only surface of a viem PublicClient used for reconciliation. */
export interface EvmStatusClient {
  getChainId(): Promise<number>;
  getTransactionCount(args: {
    address: `0x${string}`;
    blockTag: 'latest' | 'pending';
  }): Promise<number>;
  getTransactionReceipt(args: { hash: `0x${string}` }): Promise<{ status: 'success' | 'reverted' }>;
}

export function evmSubmissionScope(chainId: number, account: string): SubmissionScope {
  return { chain: 'evm', network: String(chainId), account: account.toLowerCase() };
}

function errorChain(error: unknown): Array<Record<string, unknown>> {
  const chain: Array<Record<string, unknown>> = [];
  let current: unknown = error;
  for (let depth = 0; depth < 8 && typeof current === 'object' && current !== null; depth++) {
    chain.push(current as Record<string, unknown>);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

function describe(error: Record<string, unknown>): string {
  return [error.name, error.shortMessage, error.details, error.message]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase();
}

async function findReceipt(
  client: EvmStatusClient,
  hash: string | undefined,
): Promise<{ status: 'success' | 'reverted' } | null> {
  if (!hash) return null;
  try {
    return await client.getTransactionReceipt({ hash: hash as `0x${string}` });
  } catch (error) {
    const notFound = errorChain(error).some(
      (entry) =>
        entry.name === 'TransactionReceiptNotFoundError' ||
        describe(entry).includes('could not be found'),
    );
    if (notFound) return null;
    throw error;
  }
}

/**
 * Classifies a wallet `eth_sendTransaction` failure.
 *
 * Only errors that prove the wallet or node refused the request before it
 * could be broadcast are `rejected`. "nonce too low", "already known" and
 * "replacement underpriced" can be caused by our own earlier broadcast, so
 * they stay `ambiguous` and must be reconciled first.
 */
export function classifyEvmBroadcastError(error: unknown): BroadcastErrorClass {
  for (const entry of errorChain(error)) {
    const text = describe(entry);
    if (
      entry.code === 4001 ||
      entry.name === 'UserRejectedRequestError' ||
      text.includes('user rejected') ||
      text.includes('user denied')
    ) {
      return 'rejected';
    }
    if (
      entry.name === 'ChainMismatchError' ||
      entry.name === 'ConnectorChainMismatchError' ||
      entry.name === 'InsufficientFundsError' ||
      text.includes('insufficient funds') ||
      text.includes('execution reverted')
    ) {
      return 'rejected';
    }
  }
  return 'ambiguous';
}

/**
 * Reconciles an EVM submission by `(chainId, from, nonce)`.
 *
 * - receipt for our hash → confirmed / failed (reverted)
 * - nonce consumed without our receipt → replaced (a wallet speed-up or an
 *   unrelated transaction; needs human review, never auto-resubmitted)
 * - nonce still pending in the mempool → pending
 * - nonce unused and absent from the mempool → dropped; the only permitted
 *   rebuild reuses the same nonce, so at most one transaction can land
 */
export async function reconcileEvmSubmission(
  client: EvmStatusClient,
  identity: EvmTxIdentity,
): Promise<ReconcileVerdict> {
  const chainId = await client.getChainId();
  if (chainId !== identity.chainId) {
    return { state: 'unknown', reason: 'network-mismatch' };
  }
  const address = identity.from as `0x${string}`;
  const latest = await client.getTransactionCount({ address, blockTag: 'latest' });
  const receipt = await findReceipt(client, identity.txHash);
  if (receipt && identity.txHash) {
    return receipt.status === 'success'
      ? { state: 'confirmed', txHash: identity.txHash }
      : { state: 'failed', txHash: identity.txHash, reason: 'reverted' };
  }
  if (latest > identity.nonce) {
    return {
      state: 'replaced',
      reason: identity.txHash ? 'nonce-consumed-by-another-transaction' : 'nonce-consumed',
    };
  }
  const pending = await client.getTransactionCount({ address, blockTag: 'pending' });
  if (pending > identity.nonce) return { state: 'pending' };
  return { state: 'dropped', reason: 'dropped' };
}

export function createEvmSubmissionAdapter(
  client: EvmStatusClient,
): ChainSubmissionAdapter<EvmTxIdentity> {
  return {
    reconcile: (identity) => reconcileEvmSubmission(client, identity),
    classifyBroadcastError: classifyEvmBroadcastError,
  };
}

/**
 * Chooses the nonce for a new attempt. A fresh send uses the pending nonce;
 * a rebuild after a proven drop must reuse the pinned nonce, and refuses if
 * that nonce has since been consumed (the original may have landed).
 */
export async function resolveEvmNonce(
  client: EvmStatusClient,
  address: string,
  pinnedNonce?: number,
): Promise<number> {
  const account = address as `0x${string}`;
  if (pinnedNonce === undefined) {
    return client.getTransactionCount({ address: account, blockTag: 'pending' });
  }
  const latest = await client.getTransactionCount({ address: account, blockTag: 'latest' });
  if (latest > pinnedNonce) {
    throw new SubmissionNeedsReviewError('stale-nonce');
  }
  return pinnedNonce;
}
