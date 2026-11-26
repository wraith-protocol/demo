import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION, compatibleVersion, transactionStorageError } from './appCompatibility';
import {
  activeTransactionReason,
  assertTransactionCompatible,
  beginTransactionActivity,
  cancelPreparedUpdate,
  prepareForUpdate,
  setCompatibilityError,
  withTransactionActivity,
} from './transactionActivity';

afterEach(() => {
  cancelPreparedUpdate();
  setCompatibilityError(null);
  vi.unstubAllGlobals();
});

describe('transaction-aware activation', () => {
  it.each(['simulating', 'signing', 'submitting', 'reconciling'] as const)(
    'vetoes updates during %s and unblocks only when work finishes',
    (phase) => {
      const finish = beginTransactionActivity(phase);
      try {
        expect(prepareForUpdate()).toBe(false);
      } finally {
        finish();
      }
      expect(prepareForUpdate()).toBe(true);
      expect(() => assertTransactionCompatible()).toThrow('update is in progress');
      cancelPreparedUpdate();
      expect(() => assertTransactionCompatible()).not.toThrow();
    },
  );

  it('keeps another operation protected when one completes', () => {
    const finishA = beginTransactionActivity('simulating');
    const finishB = beginTransactionActivity('signing');
    finishA();
    expect(prepareForUpdate()).toBe(false);
    finishB();
    expect(activeTransactionReason()).toBeNull();
  });

  it('releases failed asynchronous work without allowing activation mid-flight', async () => {
    await expect(
      withTransactionActivity('submitting', async () => {
        expect(prepareForUpdate()).toBe(false);
        throw new Error('wallet rejected');
      }),
    ).rejects.toThrow('wallet rejected');
    expect(activeTransactionReason()).toBeNull();
  });

  it('blocks value-moving work for incompatible clients before invoking it', async () => {
    setCompatibilityError('Reload to update');
    const submit = vi.fn();
    await expect(withTransactionActivity('submitting', submit)).rejects.toThrow('Reload to update');
    expect(submit).not.toHaveBeenCalled();
  });

  it('detects shell, API and schema mismatches', () => {
    expect(compatibleVersion(APP_VERSION)).toBe(true);
    for (const key of ['shell', 'api', 'transactionSchema'] as const) {
      expect(compatibleVersion({ ...APP_VERSION, [key]: 999 })).toBe(false);
    }
    expect(compatibleVersion(null)).toBe(false);
  });

  it('preserves a future transaction schema and vetoes activation', () => {
    const raw = JSON.stringify({ version: 999, operations: { valuable: 'keep' } });
    const removeItem = vi.fn();
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => raw, removeItem, setItem });
    expect(transactionStorageError()).toContain('different application or transaction version');
    expect(prepareForUpdate()).toBe(false);
    expect(() => assertTransactionCompatible()).toThrow();
    expect(removeItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});
