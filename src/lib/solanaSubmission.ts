import type {
  BroadcastErrorClass,
  ChainSubmissionAdapter,
  ChainTxIdentity,
  ReconcileVerdict,
  SubmissionScope,
} from './submissionIdempotency';

export type SolanaTxIdentity = Extract<ChainTxIdentity, { kind: 'solana' }>;

type Commitment = 'processed' | 'confirmed' | 'finalized';

/** Minimal surface of a `@solana/web3.js` Connection used for reconciliation. */
export interface SolanaStatusClient {
  getSignatureStatuses(
    signatures: string[],
    config: { searchTransactionHistory: boolean },
  ): Promise<{
    value: Array<{ err: unknown; confirmationStatus?: Commitment | null } | null>;
  }>;
  getBlockHeight(commitment?: Commitment): Promise<number>;
  sendRawTransaction(
    raw: Uint8Array,
    options: { skipPreflight: boolean; maxRetries?: number },
  ): Promise<string>;
}

export function solanaSubmissionScope(cluster: string, account: string): SubmissionScope {
  return { chain: 'solana', network: cluster, account };
}

export function encodeSignedTransaction(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeSignedTransaction(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 8 && typeof current === 'object' && current !== null; depth++) {
    const entry = current as { name?: unknown; message?: unknown; logs?: unknown };
    if (typeof entry.name === 'string') parts.push(entry.name);
    if (typeof entry.message === 'string') parts.push(entry.message);
    if (Array.isArray(entry.logs)) parts.push(entry.logs.join(' '));
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(' ').toLowerCase();
}

/**
 * Classifies a `sendRawTransaction` failure.
 *
 * A missing blockhash or a failed preflight simulation means the RPC never
 * forwarded the transaction, so a fresh build is safe. "Already processed"
 * means our exact signature landed. Transport failures are ambiguous.
 */
export function classifySolanaBroadcastError(error: unknown): BroadcastErrorClass {
  const text = errorText(error);
  if (text.includes('already been processed') || text.includes('alreadyprocessed')) {
    return 'already-known';
  }
  if (
    text.includes('blockhash not found') ||
    text.includes('transaction simulation failed') ||
    text.includes('insufficient funds') ||
    text.includes('insufficient lamports') ||
    text.includes('walletsigntransactionerror') ||
    text.includes('user rejected')
  ) {
    return 'rejected';
  }
  return 'ambiguous';
}

function statusVerdict(
  identity: SolanaTxIdentity,
  status: { err: unknown; confirmationStatus?: Commitment | null },
): ReconcileVerdict {
  if (status.err) {
    return { state: 'failed', txHash: identity.signature, reason: 'execution-error' };
  }
  if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
    return { state: 'confirmed', txHash: identity.signature };
  }
  return { state: 'pending' };
}

/**
 * Reconciles a Solana submission by signature.
 *
 * A signature unknown to the cluster is only `dropped` once the finalized
 * block height has passed the blockhash's `lastValidBlockHeight`: past that
 * point the signed transaction can never be included, so rebuilding with a
 * fresh blockhash cannot double-spend.
 */
export async function reconcileSolanaSubmission(
  client: SolanaStatusClient,
  identity: SolanaTxIdentity,
): Promise<ReconcileVerdict> {
  const lookup = async () =>
    (
      await client.getSignatureStatuses([identity.signature], {
        searchTransactionHistory: true,
      })
    ).value[0];

  const status = await lookup();
  if (status) return statusVerdict(identity, status);

  const finalizedHeight = await client.getBlockHeight('finalized');
  if (finalizedHeight <= identity.lastValidBlockHeight) return { state: 'pending' };

  const recheck = await lookup();
  if (recheck) return statusVerdict(identity, recheck);
  return { state: 'dropped', reason: 'expired' };
}

export function createSolanaSubmissionAdapter(
  client: SolanaStatusClient,
): ChainSubmissionAdapter<SolanaTxIdentity> {
  return {
    reconcile: (identity) => reconcileSolanaSubmission(client, identity),
    classifyBroadcastError: classifySolanaBroadcastError,
    rebroadcast: async (identity) => {
      await client.sendRawTransaction(decodeSignedTransaction(identity.signedTx), {
        skipPreflight: true,
        maxRetries: 0,
      });
    },
  };
}
