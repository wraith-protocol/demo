import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSubmissionRecord,
  reserveSubmissionOperationId,
  submitStellarTransactionOnce,
} from './submissionIdempotency';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const previousStorage = globalThis.localStorage;

afterEach(() => {
  if (previousStorage === undefined) {
    Reflect.deleteProperty(globalThis, 'localStorage');
  } else {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previousStorage,
    });
  }
});

function useMemoryStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
}

describe('Stellar submission idempotency', () => {
  it('reuses a reserved operation ID after state is reloaded', async () => {
    useMemoryStorage();
    const draft = JSON.stringify({ wallet: 'GABC', recipient: 'st:xlm:meta', amount: '2' });
    const first = await reserveSubmissionOperationId(draft);
    const afterReload = await reserveSubmissionOperationId(draft);

    expect(afterReload).toBe(first);
    expect(getSubmissionRecord(first)).toMatchObject({
      operationId: first,
      status: 'prepared',
    });
  });

  it('assigns a new operation ID when a queued intent is deliberately edited', async () => {
    useMemoryStorage();
    const originalOperationId = await reserveSubmissionOperationId('original send', 'queued-id');
    const editedOperationId = await reserveSubmissionOperationId(
      'edited send',
      originalOperationId,
    );

    expect(editedOperationId).not.toBe(originalOperationId);
    await expect(reserveSubmissionOperationId('edited send', originalOperationId)).resolves.toBe(
      editedOperationId,
    );
  });

  it('preserves records for independent drafts in the shared persistent store', async () => {
    useMemoryStorage();
    const [first, second] = await Promise.all([
      reserveSubmissionOperationId('first draft'),
      reserveSubmissionOperationId('second draft'),
    ]);

    expect(getSubmissionRecord(first)).toMatchObject({ operationId: first });
    expect(getSubmissionRecord(second)).toMatchObject({ operationId: second });
  });

  it('serializes concurrent sends and returns the original result to delayed retries', async () => {
    useMemoryStorage();
    const operationId = await reserveSubmissionOperationId('same send');
    let resolveSubmit!: (hash: string) => void;
    const submit = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const firstAttempt = submitStellarTransactionOnce(
      operationId,
      'tx-1',
      'signed-envelope-1',
      submit,
    );
    const delayedRetry = submitStellarTransactionOnce(
      operationId,
      'tx-1',
      'signed-envelope-1',
      submit,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(submit).toHaveBeenCalledTimes(1);
    resolveSubmit('tx-1');
    await expect(Promise.all([firstAttempt, delayedRetry])).resolves.toEqual(['tx-1', 'tx-1']);

    await expect(
      submitStellarTransactionOnce(operationId, 'tx-1', 'signed-envelope-1', submit),
    ).resolves.toBe('tx-1');
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('retries an uncertain request only with the same envelope and blocks changed transactions', async () => {
    useMemoryStorage();
    const operationId = await reserveSubmissionOperationId('retry after timeout');
    const firstSubmission = vi.fn(async () => {
      throw new TypeError('response timed out');
    });

    await expect(
      submitStellarTransactionOnce(operationId, 'tx-2', 'signed-envelope-2', firstSubmission),
    ).rejects.toThrow('response timed out');
    expect(getSubmissionRecord(operationId)).toMatchObject({
      status: 'submitting',
      txHash: 'tx-2',
      signedEnvelope: 'signed-envelope-2',
    });

    const retry = vi.fn(async () => 'tx-2');
    await expect(
      submitStellarTransactionOnce(operationId, 'tx-2', 'signed-envelope-2', retry),
    ).resolves.toBe('tx-2');
    expect(retry).toHaveBeenCalledOnce();

    const changedTransaction = vi.fn(async () => 'tx-3');
    await expect(
      submitStellarTransactionOnce(operationId, 'tx-3', 'signed-envelope-3', changedTransaction),
    ).rejects.toThrow('already bound to a different signed transaction');
    expect(changedTransaction).not.toHaveBeenCalled();
  });
});
