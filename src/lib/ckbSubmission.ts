import type {
  BroadcastErrorClass,
  ChainSubmissionAdapter,
  ChainTxIdentity,
  ReconcileVerdict,
  SubmissionScope,
} from './submissionIdempotency';

export type CkbTxIdentity = Extract<ChainTxIdentity, { kind: 'ckb' }>;

export type CkbTxStatus = 'sent' | 'pending' | 'proposed' | 'committed' | 'unknown' | 'rejected';

/**
 * Minimal surface of a CCC client used for reconciliation. `isCellLive`
 * must answer from committed chain state only (not the tx pool), so a dead
 * input proves another committed transaction consumed it.
 */
export interface CkbStatusClient {
  getTransactionStatus(txHash: string): Promise<CkbTxStatus | undefined>;
  isCellLive(outPoint: { txHash: string; index: number }): Promise<boolean>;
  sendSignedTransaction(signedTx: string): Promise<string>;
}

export function ckbSubmissionScope(network: string, account: string): SubmissionScope {
  return { chain: 'ckb', network, account };
}

export function formatOutPoint(outPoint: { txHash: string; index: number | bigint }): string {
  return `${outPoint.txHash}:${Number(outPoint.index)}`;
}

export function parseOutPoint(value: string): { txHash: string; index: number } {
  const separator = value.lastIndexOf(':');
  const index = Number(value.slice(separator + 1));
  if (separator <= 0 || !Number.isSafeInteger(index) || index < 0) {
    throw new Error(`Invalid CKB out-point: ${value}`);
  }
  return { txHash: value.slice(0, separator), index };
}

function errorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 8 && typeof current === 'object' && current !== null; depth++) {
    const entry = current as { name?: unknown; message?: unknown; data?: unknown };
    if (typeof entry.name === 'string') parts.push(entry.name);
    if (typeof entry.message === 'string') parts.push(entry.message);
    if (typeof entry.data === 'string') parts.push(entry.data);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(' ').toLowerCase();
}

/**
 * Classifies a CKB `send_transaction` failure.
 *
 * A duplicate means our exact transaction is already in the pool. Dead or
 * unknown inputs may have been consumed by our own earlier broadcast, so
 * they stay ambiguous until reconciliation checks the transaction hash.
 * Verification, fee and capacity failures mean the node refused it.
 */
export function classifyCkbBroadcastError(error: unknown): BroadcastErrorClass {
  const text = errorText(error);
  if (text.includes('duplicated') || text.includes('poolrejectedduplicatedtransaction')) {
    return 'already-known';
  }
  if (
    text.includes('transactionfailedtoresolve') ||
    text.includes('dead(') ||
    text.includes('unknown outpoint')
  ) {
    return 'ambiguous';
  }
  if (
    text.includes('transactionfailedtoverify') ||
    text.includes('maxfeerate') ||
    text.includes('insufficient') ||
    text.includes('poolrejectedrbf') ||
    text.includes('pooltransactionfeelow') ||
    text.includes('user rejected')
  ) {
    return 'rejected';
  }
  return 'ambiguous';
}

async function anyInputConsumed(client: CkbStatusClient, inputs: string[]): Promise<boolean> {
  for (const input of inputs) {
    if (!(await client.isCellLive(parseOutPoint(input)))) return true;
  }
  return false;
}

/**
 * Reconciles a CKB submission by transaction hash.
 *
 * A consumed input with the tracked hash absent is never proof that the
 * payment did not happen: the consuming transaction may be a wallet
 * replacement or retry that paid the same recipient, and a rebuild from new
 * inputs could then pay twice. That case is `replaced` (human review), and
 * no CKB outcome ever permits an automatic rebuild. Only identical signed
 * bytes are rebroadcast while the outcome is pending or unknown.
 */
export async function reconcileCkbSubmission(
  client: CkbStatusClient,
  identity: CkbTxIdentity,
): Promise<ReconcileVerdict> {
  const status = await client.getTransactionStatus(identity.txHash);
  if (status === 'committed') return { state: 'confirmed', txHash: identity.txHash };
  if (status === 'sent' || status === 'pending' || status === 'proposed') {
    return { state: 'pending' };
  }

  if (await anyInputConsumed(client, identity.inputs)) {
    const recheck = await client.getTransactionStatus(identity.txHash);
    if (recheck === 'committed') return { state: 'confirmed', txHash: identity.txHash };
    return { state: 'replaced', reason: 'input-consumed-by-another-transaction' };
  }
  return status === 'rejected'
    ? { state: 'unknown', reason: 'rejected-by-pool-with-live-inputs' }
    : { state: 'unknown', reason: 'not-found' };
}

export function createCkbSubmissionAdapter(
  client: CkbStatusClient,
): ChainSubmissionAdapter<CkbTxIdentity> {
  return {
    reconcile: (identity) => reconcileCkbSubmission(client, identity),
    classifyBroadcastError: classifyCkbBroadcastError,
    rebroadcast: async (identity) => {
      await client.sendSignedTransaction(identity.signedTx);
    },
  };
}
