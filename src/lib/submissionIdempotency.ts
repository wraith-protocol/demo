const STORAGE_KEY = 'wraith-submission-idempotency-v1';

export interface SubmissionRecord {
  operationId: string;
  draftKey: string;
  status: 'prepared' | 'submitting' | 'submitted';
  txHash?: string;
  signedEnvelope?: string;
  metadata?: Record<string, string | number>;
}

export class TransactionSubmissionUnknownError extends Error {
  constructor() {
    super('The transaction response was lost; retrying will reuse the same signed transaction.');
    this.name = 'TransactionSubmissionUnknownError';
  }
}

interface SubmissionState {
  version: 1;
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
  if (value === null) return { version: 1, operations: {}, drafts: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Saved transaction submission state is invalid; clear it before retrying.');
  }
  if (
    !isRecord(parsed) ||
    !('version' in parsed) ||
    parsed.version !== 1 ||
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
  return { version: 1, operations, drafts };
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

function isSubmissionRecord(value: unknown): value is SubmissionRecord {
  if (!isRecord(value)) return false;
  const record = value as Partial<SubmissionRecord>;
  return (
    typeof record.operationId === 'string' &&
    typeof record.draftKey === 'string' &&
    (record.status === 'prepared' ||
      record.status === 'submitting' ||
      record.status === 'submitted') &&
    (record.txHash === undefined || typeof record.txHash === 'string') &&
    (record.signedEnvelope === undefined || typeof record.signedEnvelope === 'string')
  );
}

export async function reserveSubmissionOperationId(
  draft: string,
  preferredOperationId?: string | null,
): Promise<string> {
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
  return withLock(`operation:${operationId}`, async () => {
    const start = await withLock('state', () => {
      const state = readState();
      if (!isValidOperationId(operationId)) {
        throw new Error('The transaction operation ID is invalid.');
      }
      const existing = ownValue(state.operations, operationId);
      if (existing !== undefined && !isSubmissionRecord(existing)) {
        throw new Error('Saved transaction submission state is invalid; clear it before retrying.');
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
