import { APP_VERSION, SUBMISSION_STORAGE_KEY } from './appCompatibility';
import {
  assertTransactionCompatible,
  beginTransactionActivity,
  withTransactionActivity,
} from './transactionActivity';
const STORAGE_KEY = SUBMISSION_STORAGE_KEY;

export type SubmissionStatus = 'prepared' | 'submitting' | 'submitted' | 'confirmed' | 'failed';

export type ChainSubmissionChain = 'evm' | 'solana' | 'ckb';

/**
 * The wallet/network a non-Stellar submission is bound to. A record is only
 * ever reconciled, rebroadcast or rebuilt under the exact scope it was
 * created with, so switching account or network can never resubmit it.
 */
export interface SubmissionScope {
  chain: ChainSubmissionChain;
  network: string;
  account: string;
}

/**
 * Chain-specific transaction identity, persisted before broadcast so an
 * ambiguous outcome can be reconciled against authoritative chain state.
 *
 * - EVM: `(chainId, from, nonce)`; the hash is only known once the wallet
 *   returns, and the nonce stays pinned so any rebuild replaces in place.
 * - Solana: the fee-payer signature plus the blockhash validity window; the
 *   signed bytes are kept so retries rebroadcast the identical transaction.
 * - CKB: the signed transaction hash and its input out-points; a consumed
 *   input with the hash absent may be a wallet replacement that already
 *   paid, so it requires review rather than permitting a rebuild.
 */
export type ChainTxIdentity =
  | { kind: 'evm'; chainId: number; from: string; nonce: number; txHash?: string }
  | {
      kind: 'solana';
      cluster: string;
      from: string;
      signature: string;
      blockhash: string;
      lastValidBlockHeight: number;
      signedTx: string;
    }
  | {
      kind: 'ckb';
      network: string;
      from: string;
      txHash: string;
      signedTx: string;
      inputs: string[];
    };

export interface SubmissionRecord {
  operationId: string;
  draftKey: string;
  status: SubmissionStatus;
  txHash?: string;
  signedEnvelope?: string;
  metadata?: Record<string, string | number>;
  chain?: ChainSubmissionChain;
  scope?: SubmissionScope;
  identity?: ChainTxIdentity;
  pinnedNonce?: number;
  resolution?: string;
  updatedAt?: number;
}

export class TransactionSubmissionUnknownError extends Error {
  constructor() {
    super('The transaction response was lost; retrying will reuse the same signed transaction.');
    this.name = 'TransactionSubmissionUnknownError';
  }
}

interface SubmissionState {
  version: number;
  operations: Record<string, SubmissionRecord>;
  drafts: Record<string, string>;
}

const localLocks = new Map<string, Promise<void>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ownValue<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function isValidOperationId(value: string): boolean {
  return (
    /^[A-Za-z0-9_-]{1,128}$/.test(value) &&
    value !== '__proto__' &&
    value !== 'constructor' &&
    value !== 'prototype'
  );
}

function storage(): Storage {
  if (typeof localStorage === 'undefined') {
    throw new Error('Persistent storage is required for safe transaction submission.');
  }
  return localStorage;
}

function readState(): SubmissionState {
  const value = storage().getItem(STORAGE_KEY);
  if (value === null) return { version: APP_VERSION.transactionSchema, operations: {}, drafts: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Saved transaction submission state is invalid; clear it before retrying.');
  }
  if (
    !isRecord(parsed) ||
    !('version' in parsed) ||
    parsed.version !== APP_VERSION.transactionSchema ||
    !('operations' in parsed) ||
    !isRecord(parsed.operations) ||
    !('drafts' in parsed) ||
    !isRecord(parsed.drafts)
  ) {
    throw new Error('Saved transaction submission state is invalid; clear it before retrying.');
  }
  const operations: Record<string, SubmissionRecord> = {};
  for (const [operationId, record] of Object.entries(parsed.operations)) {
    if (
      !isValidOperationId(operationId) ||
      !isSubmissionRecord(record) ||
      record.operationId !== operationId
    ) {
      throw new Error('Saved transaction submission state is invalid; clear it before retrying.');
    }
    operations[operationId] = record;
  }
  const drafts: Record<string, string> = {};
  for (const [draftKey, operationId] of Object.entries(parsed.drafts)) {
    if (
      !/^[a-f0-9]{64}$/.test(draftKey) ||
      typeof operationId !== 'string' ||
      !isValidOperationId(operationId)
    ) {
      throw new Error('Saved transaction submission state is invalid; clear it before retrying.');
    }
    drafts[draftKey] = operationId;
  }
  return { version: APP_VERSION.transactionSchema, operations, drafts };
}

function writeState(state: SubmissionState): void {
  storage().setItem(STORAGE_KEY, JSON.stringify(state));
}

async function withLock<T>(name: string, action: () => Promise<T> | T): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(`wraith-submission:${name}`, { mode: 'exclusive' }, action);
  }
  if (typeof window !== 'undefined') {
    throw new Error('This browser cannot safely coordinate transaction retries across tabs.');
  }

  const previous = localLocks.get(name) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  localLocks.set(name, tail);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (localLocks.get(name) === tail) localLocks.delete(name);
  }
}

function makeOperationId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `submission-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function hashDraft(draft: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('This browser cannot safely persist a transaction operation ID.');
  }
  const bytes = new TextEncoder().encode(draft);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const SUBMISSION_STATUSES: readonly SubmissionStatus[] = [
  'prepared',
  'submitting',
  'submitted',
  'confirmed',
  'failed',
];

function isScope(value: unknown): value is SubmissionScope {
  if (!isRecord(value)) return false;
  return (
    (value.chain === 'evm' || value.chain === 'solana' || value.chain === 'ckb') &&
    typeof value.network === 'string' &&
    typeof value.account === 'string'
  );
}

function isIdentity(value: unknown): value is ChainTxIdentity {
  if (!isRecord(value) || typeof value.from !== 'string') return false;
  switch (value.kind) {
    case 'evm':
      return (
        Number.isSafeInteger(value.chainId) &&
        Number.isSafeInteger(value.nonce) &&
        (value.nonce as number) >= 0 &&
        (value.txHash === undefined || typeof value.txHash === 'string')
      );
    case 'solana':
      return (
        typeof value.cluster === 'string' &&
        typeof value.signature === 'string' &&
        typeof value.blockhash === 'string' &&
        Number.isSafeInteger(value.lastValidBlockHeight) &&
        typeof value.signedTx === 'string'
      );
    case 'ckb':
      return (
        typeof value.network === 'string' &&
        typeof value.txHash === 'string' &&
        typeof value.signedTx === 'string' &&
        Array.isArray(value.inputs) &&
        value.inputs.every((input) => typeof input === 'string')
      );
    default:
      return false;
  }
}

function isSubmissionRecord(value: unknown): value is SubmissionRecord {
  if (!isRecord(value)) return false;
  const record = value as Partial<SubmissionRecord>;
  return (
    typeof record.operationId === 'string' &&
    typeof record.draftKey === 'string' &&
    SUBMISSION_STATUSES.includes(record.status as SubmissionStatus) &&
    (record.txHash === undefined || typeof record.txHash === 'string') &&
    (record.signedEnvelope === undefined || typeof record.signedEnvelope === 'string') &&
    (record.scope === undefined || isScope(record.scope)) &&
    (record.identity === undefined || isIdentity(record.identity)) &&
    (record.pinnedNonce === undefined || Number.isSafeInteger(record.pinnedNonce))
  );
}

export async function reserveSubmissionOperationId(
  draft: string,
  preferredOperationId?: string | null,
): Promise<string> {
  assertTransactionCompatible();
  const draftKey = await hashDraft(draft);
  return withLock(`draft:${draftKey}`, () =>
    withLock('state', () => {
      const state = readState();
      const mappedOperationId = ownValue(state.drafts, draftKey);
      const mappedRecord = mappedOperationId
        ? ownValue(state.operations, mappedOperationId)
        : undefined;
      const preferredRecord = preferredOperationId
        ? ownValue(state.operations, preferredOperationId)
        : undefined;
      if (
        (mappedRecord !== undefined && !isSubmissionRecord(mappedRecord)) ||
        (preferredRecord !== undefined && !isSubmissionRecord(preferredRecord))
      ) {
        throw new Error('Saved transaction submission state is invalid; clear it before retrying.');
      }
      let operationId = makeOperationId();
      if (mappedOperationId && mappedRecord && mappedRecord.draftKey === draftKey) {
        operationId = mappedOperationId;
      } else if (
        preferredOperationId &&
        (!preferredRecord || preferredRecord.draftKey === draftKey)
      ) {
        operationId = preferredOperationId;
      }
      if (!isValidOperationId(operationId)) {
        throw new Error('The transaction operation ID is invalid.');
      }
      state.drafts[draftKey] = operationId;
      const existing = ownValue(state.operations, operationId);
      if (existing && !isSubmissionRecord(existing)) {
        throw new Error('Saved transaction submission state is invalid; clear it before retrying.');
      }
      state.operations[operationId] ??= {
        operationId,
        draftKey,
        status: 'prepared',
      };
      writeState(state);
      return operationId;
    }),
  );
}

export function getSubmissionRecord(operationId: string): SubmissionRecord | null {
  const value = ownValue(readState().operations, operationId);
  if (value === undefined) return null;
  if (!isSubmissionRecord(value)) {
    throw new Error('Saved transaction submission state is invalid; clear it before retrying.');
  }
  return value;
}

export async function releaseSubmissionDraft(draft: string, operationId: string): Promise<void> {
  const draftKey = await hashDraft(draft);
  await withLock(`draft:${draftKey}`, () =>
    withLock('state', () => {
      const state = readState();
      if (ownValue(state.drafts, draftKey) === operationId) {
        delete state.drafts[draftKey];
        writeState(state);
      }
    }),
  );
}

export async function submitStellarTransactionOnce(
  operationId: string,
  txHash: string,
  signedEnvelope: string,
  submit: () => Promise<string>,
  metadata?: Record<string, string | number>,
): Promise<string> {
  assertTransactionCompatible();
  const finish = beginTransactionActivity('submitting');
  try {
    return await withLock(`operation:${operationId}`, async () => {
      const start = await withLock('state', () => {
        const state = readState();
        if (!isValidOperationId(operationId)) {
          throw new Error('The transaction operation ID is invalid.');
        }
        const existing = ownValue(state.operations, operationId);
        if (existing !== undefined && !isSubmissionRecord(existing)) {
          throw new Error(
            'Saved transaction submission state is invalid; clear it before retrying.',
          );
        }
        if (
          existing?.txHash &&
          (existing.txHash !== txHash || existing.signedEnvelope !== signedEnvelope)
        ) {
          throw new Error('This operation ID is already bound to a different signed transaction.');
        }
        if (existing?.status === 'submitted' && existing.txHash) {
          return { alreadySubmitted: true as const, hash: existing.txHash };
        }

        const record: SubmissionRecord = {
          operationId,
          draftKey: existing?.draftKey ?? '',
          status: 'submitting',
          txHash,
          signedEnvelope,
          ...((metadata ?? existing?.metadata) ? { metadata: metadata ?? existing?.metadata } : {}),
        };
        state.operations[operationId] = record;
        writeState(state);
        return { alreadySubmitted: false as const, record };
      });
      if (start.alreadySubmitted) return start.hash;

      const submittedHash = await submit();
      await withLock('state', () => {
        const state = readState();
        state.operations[operationId] = {
          ...start.record,
          status: 'submitted',
          txHash: submittedHash || txHash,
        };
        writeState(state);
      });
      return submittedHash || txHash;
    });
  } finally {
    finish();
  }
}

export async function broadcastStellarTransaction(
  signedEnvelope: string,
  fallbackHash: string,
  horizonUrl: string,
): Promise<string> {
  let response: Response;
  let data: {
    hash?: string;
    title?: string;
    extras?: { result_codes?: { transaction?: string } };
  };
  try {
    response = await fetch(`${horizonUrl}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `tx=${encodeURIComponent(signedEnvelope)}`,
    });
    data = (await response.json()) as typeof data;
  } catch {
    throw new TransactionSubmissionUnknownError();
  }
  if (response.status >= 500 || response.status === 429) {
    throw new TransactionSubmissionUnknownError();
  }
  if (!response.ok) {
    throw new Error(data.extras?.result_codes?.transaction || data.title || 'Broadcast failed.');
  }
  return data.hash ?? fallbackHash;
}

/**
 * Authoritative (or explicitly non-authoritative) view of a broadcast
 * attempt. Only `dropped` permits a rebuild: it means the original
 * transaction can provably never land and that no replacement could have
 * satisfied the operation (an expired Solana blockhash, or an unused EVM
 * nonce that any rebuild must reuse). Consumed CKB inputs are `replaced`.
 */
export type ReconcileVerdict =
  | { state: 'confirmed'; txHash: string }
  | { state: 'failed'; txHash: string; reason: string }
  | { state: 'pending' }
  | { state: 'unknown'; reason: string }
  | { state: 'dropped'; reason: 'expired' | 'dropped' }
  | { state: 'replaced'; reason: string };

export type BroadcastErrorClass = 'rejected' | 'ambiguous' | 'already-known';

export interface ChainSubmissionAdapter<I extends ChainTxIdentity = ChainTxIdentity> {
  reconcile(identity: I): Promise<ReconcileVerdict>;
  classifyBroadcastError(error: unknown): BroadcastErrorClass;
  /** Rebroadcasts the identical signed bytes; must never re-sign or rebuild. */
  rebroadcast?(identity: I): Promise<void>;
}

export interface PreparedChainSubmission<I extends ChainTxIdentity = ChainTxIdentity> {
  identity: I;
  broadcast: () => Promise<string>;
  metadata?: Record<string, string | number>;
}

export interface PrepareContext {
  /** Set after an EVM attempt was proven dropped: the rebuild must reuse it. */
  pinnedNonce?: number;
}

export type ChainSubmissionResult =
  | { status: 'submitted' | 'confirmed'; txHash: string; record: SubmissionRecord }
  | { status: 'failed'; txHash: string; reason: string; record: SubmissionRecord };

export class SubmissionOutcomePendingError extends Error {
  readonly verdict: ReconcileVerdict | null;
  readonly cause: unknown;
  constructor(verdict: ReconcileVerdict | null = null, cause?: unknown) {
    super(
      'The transaction may already have been broadcast. It will not be rebuilt or resubmitted until the network reports its final status.',
    );
    this.name = 'SubmissionOutcomePendingError';
    this.verdict = verdict;
    this.cause = cause;
  }
}

export class SubmissionNeedsReviewError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(
      `The previous transaction cannot be confirmed automatically (${reason}). Check it in the explorer before starting a new transfer.`,
    );
    this.name = 'SubmissionNeedsReviewError';
    this.reason = reason;
  }
}

export class SubmissionScopeMismatchError extends Error {
  constructor() {
    super(
      'This submission belongs to a different wallet account or network. Switch back to it to check its status.',
    );
    this.name = 'SubmissionScopeMismatchError';
  }
}

export function isAmbiguousSubmissionError(error: unknown): boolean {
  return (
    error instanceof SubmissionOutcomePendingError ||
    error instanceof SubmissionNeedsReviewError ||
    error instanceof TransactionSubmissionUnknownError
  );
}

function sameScope(a: SubmissionScope, b: SubmissionScope): boolean {
  return (
    a.chain === b.chain &&
    a.network === b.network &&
    a.account.toLowerCase() === b.account.toLowerCase()
  );
}

function identityMatchesScope(identity: ChainTxIdentity, scope: SubmissionScope): boolean {
  if (identity.from.toLowerCase() !== scope.account.toLowerCase()) return false;
  switch (identity.kind) {
    case 'evm':
      return scope.chain === 'evm' && String(identity.chainId) === scope.network;
    case 'solana':
      return scope.chain === 'solana' && identity.cluster === scope.network;
    case 'ckb':
      return scope.chain === 'ckb' && identity.network === scope.network;
  }
}

function identityHash(identity: ChainTxIdentity): string | undefined {
  switch (identity.kind) {
    case 'evm':
      return identity.txHash;
    case 'solana':
      return identity.signature;
    case 'ckb':
      return identity.txHash;
  }
}

function isUnresolved(record: SubmissionRecord): boolean {
  return (
    record.identity !== undefined &&
    (record.status === 'submitting' || record.status === 'submitted')
  );
}

async function mutateRecord(
  operationId: string,
  mutate: (record: SubmissionRecord | undefined) => SubmissionRecord,
): Promise<SubmissionRecord> {
  return withLock('state', () => {
    if (!isValidOperationId(operationId)) {
      throw new Error('The transaction operation ID is invalid.');
    }
    const state = readState();
    const next = { ...mutate(ownValue(state.operations, operationId)), updatedAt: Date.now() };
    state.operations[operationId] = next;
    writeState(state);
    return next;
  });
}

function loadScopedRecord(operationId: string, scope: SubmissionScope): SubmissionRecord | null {
  if (!isValidOperationId(operationId)) {
    throw new Error('The transaction operation ID is invalid.');
  }
  const record = getSubmissionRecord(operationId);
  if (record?.scope && !sameScope(record.scope, scope)) {
    throw new SubmissionScopeMismatchError();
  }
  return record;
}

async function applyVerdict(
  operationId: string,
  record: SubmissionRecord,
  verdict: ReconcileVerdict,
): Promise<SubmissionRecord> {
  switch (verdict.state) {
    case 'confirmed':
      return mutateRecord(operationId, () => ({
        ...record,
        status: 'confirmed',
        txHash: verdict.txHash,
        resolution: 'confirmed',
      }));
    case 'failed':
      return mutateRecord(operationId, () => ({
        ...record,
        status: 'failed',
        txHash: verdict.txHash,
        resolution: verdict.reason,
      }));
    case 'dropped':
      return mutateRecord(operationId, () => {
        const { identity, txHash: _txHash, ...rest } = record;
        return {
          ...rest,
          status: 'prepared',
          resolution: verdict.reason,
          ...(identity?.kind === 'evm' ? { pinnedNonce: identity.nonce } : {}),
        };
      });
    case 'replaced':
      return mutateRecord(operationId, () => ({ ...record, resolution: 'replaced' }));
    default:
      return record;
  }
}

async function reconcileUnderLock(
  operationId: string,
  record: SubmissionRecord,
  adapter: ChainSubmissionAdapter,
): Promise<{ verdict: ReconcileVerdict; record: SubmissionRecord }> {
  const identity = record.identity!;
  let verdict: ReconcileVerdict;
  try {
    verdict = await adapter.reconcile(identity);
  } catch (error) {
    verdict = {
      state: 'unknown',
      reason: error instanceof Error ? error.message : 'status lookup failed',
    };
  }
  if ((verdict.state === 'pending' || verdict.state === 'unknown') && adapter.rebroadcast) {
    try {
      await adapter.rebroadcast(identity);
    } catch {
      // Rebroadcasting identical bytes is best-effort; the verdict stands.
    }
  }
  return { verdict, record: await applyVerdict(operationId, record, verdict) };
}

/**
 * Re-checks an unresolved submission against the chain without ever
 * preparing, signing or rebuilding a transaction.
 */
export async function reconcileChainSubmission(
  operationId: string,
  scope: SubmissionScope,
  adapter: ChainSubmissionAdapter,
): Promise<{ verdict: ReconcileVerdict | null; record: SubmissionRecord | null }> {
  return withTransactionActivity('reconciling', () =>
    withLock(`operation:${operationId}`, async () => {
      const record = loadScopedRecord(operationId, scope);
      if (!record || !isUnresolved(record)) return { verdict: null, record };
      return reconcileUnderLock(operationId, record, adapter);
    }),
  );
}

/**
 * Submits a non-Stellar transaction at most once per operation ID.
 *
 * The chain identity is persisted before broadcast. Any later call for the
 * same operation first reconciles that identity: confirmed/failed outcomes
 * are returned as-is, pending/unknown outcomes throw
 * `SubmissionOutcomePendingError`, and `prepare` runs again only once the
 * original transaction is proven `dropped` (EVM rebuilds reuse its nonce).
 */
export async function submitChainTransactionOnce(options: {
  operationId: string;
  scope: SubmissionScope;
  adapter: ChainSubmissionAdapter;
  prepare: (context: PrepareContext) => Promise<PreparedChainSubmission>;
}): Promise<ChainSubmissionResult> {
  const { operationId, scope, adapter, prepare } = options;
  return withTransactionActivity('submitting', () =>
    submitChainUnderLock(operationId, scope, adapter, prepare),
  );
}

async function submitChainUnderLock(
  operationId: string,
  scope: SubmissionScope,
  adapter: ChainSubmissionAdapter,
  prepare: (context: PrepareContext) => Promise<PreparedChainSubmission>,
): Promise<ChainSubmissionResult> {
  return withLock(`operation:${operationId}`, async () => {
    let record = loadScopedRecord(operationId, scope);
    if (!record) {
      throw new Error('Reserve an operation ID before submitting a transaction.');
    }

    if (record.status === 'confirmed' && record.txHash) {
      return { status: 'confirmed', txHash: record.txHash, record };
    }
    if (record.status === 'failed' && record.txHash) {
      return {
        status: 'failed',
        txHash: record.txHash,
        reason: record.resolution ?? 'failed',
        record,
      };
    }

    if (isUnresolved(record)) {
      const wasAcknowledged = record.status === 'submitted';
      const reconciled = await reconcileUnderLock(operationId, record, adapter);
      record = reconciled.record;
      const { verdict } = reconciled;
      if (verdict.state === 'confirmed') {
        return { status: 'confirmed', txHash: verdict.txHash, record };
      }
      if (verdict.state === 'failed') {
        return { status: 'failed', txHash: verdict.txHash, reason: verdict.reason, record };
      }
      if (verdict.state === 'replaced') {
        throw new SubmissionNeedsReviewError(verdict.reason);
      }
      if (verdict.state === 'pending' || verdict.state === 'unknown') {
        if (wasAcknowledged && record.txHash) {
          return { status: 'submitted', txHash: record.txHash, record };
        }
        throw new SubmissionOutcomePendingError(verdict);
      }
    }

    const attempt = await prepare(
      record.pinnedNonce !== undefined ? { pinnedNonce: record.pinnedNonce } : {},
    );
    if (!identityMatchesScope(attempt.identity, scope)) {
      throw new SubmissionScopeMismatchError();
    }
    if (
      attempt.identity.kind === 'evm' &&
      record.pinnedNonce !== undefined &&
      attempt.identity.nonce !== record.pinnedNonce
    ) {
      throw new Error('A rebuilt EVM transaction must reuse the nonce of the dropped attempt.');
    }

    const base = record;
    const submitting = await mutateRecord(operationId, () => ({
      ...base,
      chain: scope.chain,
      scope,
      status: 'submitting',
      identity: attempt.identity,
      ...(attempt.identity.kind === 'evm' ? { pinnedNonce: attempt.identity.nonce } : {}),
      ...(identityHash(attempt.identity) ? { txHash: identityHash(attempt.identity) } : {}),
      ...((attempt.metadata ?? base.metadata)
        ? { metadata: attempt.metadata ?? base.metadata }
        : {}),
      resolution: undefined,
    }));

    let broadcastHash: string;
    try {
      broadcastHash = await attempt.broadcast();
    } catch (error) {
      const errorClass = adapter.classifyBroadcastError(error);
      if (errorClass === 'rejected') {
        await mutateRecord(operationId, () => {
          const { identity: _identity, txHash: _txHash, ...rest } = submitting;
          return { ...rest, status: 'prepared', resolution: 'rejected' };
        });
        throw error;
      }
      const knownHash = identityHash(attempt.identity);
      if (errorClass === 'already-known' && knownHash) {
        broadcastHash = knownHash;
      } else {
        throw new SubmissionOutcomePendingError(null, error);
      }
    }

    const txHash = broadcastHash || identityHash(attempt.identity) || '';
    const identity: ChainTxIdentity =
      attempt.identity.kind === 'evm' ? { ...attempt.identity, txHash } : attempt.identity;
    const submitted = await mutateRecord(operationId, () => ({
      ...submitting,
      status: 'submitted',
      identity,
      txHash,
    }));
    return { status: 'submitted', txHash, record: submitted };
  });
}

/** Unresolved submissions bound to exactly this wallet account and network. */
export function findUnresolvedChainSubmission(scope: SubmissionScope): SubmissionRecord | null {
  return (
    Object.values(readState().operations).find(
      (record) => record.scope && sameScope(record.scope, scope) && isUnresolved(record),
    ) ?? null
  );
}

/** Unresolved submissions on this chain bound to another account or network. */
export function listForeignUnresolvedSubmissions(scope: SubmissionScope): SubmissionRecord[] {
  return Object.values(readState().operations).filter(
    (record) =>
      record.scope?.chain === scope.chain &&
      !sameScope(record.scope, scope) &&
      isUnresolved(record),
  );
}

/**
 * Explicit user decision to stop tracking a submission after reviewing it in
 * an explorer. Never called automatically.
 */
export async function discardChainSubmission(
  operationId: string,
  scope: SubmissionScope,
): Promise<void> {
  await withLock(`operation:${operationId}`, () =>
    withLock('state', () => {
      const state = readState();
      const record = ownValue(state.operations, operationId);
      if (!record) return;
      if (record.scope && !sameScope(record.scope, scope)) {
        throw new SubmissionScopeMismatchError();
      }
      delete state.operations[operationId];
      for (const [draftKey, mapped] of Object.entries(state.drafts)) {
        if (mapped === operationId) delete state.drafts[draftKey];
      }
      writeState(state);
    }),
  );
}
