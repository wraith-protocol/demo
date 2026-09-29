import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useIdempotentTransaction, type TxBuilderPhases } from './useIdempotentTransaction';
import { useTransactionIntentStore } from '@/stores/transactionIntentStore';
import { useActivityStore } from '@/stores/activityStore';

// Helper to create a two-phase builder from simple values
function makePhases<T>(
  txHash: string,
  result: T,
  opts?: { buildError?: Error; submitError?: Error },
): TxBuilderPhases<T> {
  return {
    build: opts?.buildError
      ? vi.fn().mockRejectedValue(opts.buildError)
      : vi.fn().mockResolvedValue({ txHash, signedTx: { signedXdr: 'xdr_' + txHash } }),
    submit: opts?.submitError
      ? vi.fn().mockRejectedValue(opts.submitError)
      : vi.fn().mockResolvedValue(result),
  };
}

describe('useIdempotentTransaction', () => {
  beforeEach(() => {
    useTransactionIntentStore.setState({ intents: [] });
    useActivityStore.setState({ entries: [] });
    vi.clearAllMocks();
  });

  it('should handle successful transaction submission', async () => {
    const phases = makePhases('tx_abc123', { success: true });

    const { result } = renderHook(() =>
      useIdempotentTransaction({
        chain: 'stellar',
        wallet: 'GTEST123',
        action: 'send',
        metadata: { recipient: 'st:xlm:test', amount: '10' },
      }),
    );

    await act(async () => {
      await result.current.submit(phases);
    });

    expect(phases.build).toHaveBeenCalledTimes(1);
    expect(phases.submit).toHaveBeenCalledTimes(1);
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.intentId).toBeTruthy();

    const { intents } = useTransactionIntentStore.getState();
    expect(intents.length).toBe(1);
    expect(intents[0].status).toBe('confirmed');
    expect(intents[0].txHash).toBe('tx_abc123');

    const { entries } = useActivityStore.getState();
    expect(entries.length).toBe(1);
    expect(entries[0].id).toBe('tx_abc123');
    expect(entries[0].status).toBe('confirmed');
  });

  it('should prevent double submission on rapid clicks', async () => {
    const phases: TxBuilderPhases<{ success: boolean }> = {
      build: vi
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ txHash: 'tx_abc123', signedTx: {} }), 100),
            ),
        ),
      submit: vi.fn().mockResolvedValue({ success: true }),
    };

    const { result } = renderHook(() =>
      useIdempotentTransaction({
        chain: 'stellar',
        wallet: 'GTEST123',
        action: 'send',
        metadata: { recipient: 'st:xlm:test', amount: '10' },
      }),
    );

    act(() => {
      result.current.submit(phases);
      result.current.submit(phases); // second call should be blocked
    });

    await waitFor(() => expect(result.current.isSubmitting).toBe(false));

    expect(phases.build).toHaveBeenCalledTimes(1);
  });

  it('should handle wallet rejection in build phase', async () => {
    const phases = makePhases(
      'tx_abc123',
      {},
      { buildError: new Error('User rejected signature') },
    );
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useIdempotentTransaction({
        chain: 'stellar',
        wallet: 'GTEST123',
        action: 'send',
      }),
    );

    await act(async () => {
      await result.current.submit(phases, { onError });
    });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'User rejected signature' }),
    );

    const { intents } = useTransactionIntentStore.getState();
    expect(intents.length).toBe(1);
    expect(intents[0].status).toBe('failed');
    expect(intents[0].error).toBe('User rejected signature');
  });

  it('should handle network timeout in submit phase', async () => {
    // build succeeds, submit times out — hash must already be persisted
    const phases = makePhases('tx_timeout123', {}, { submitError: new Error('Network timeout') });
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useIdempotentTransaction({
        chain: 'stellar',
        wallet: 'GTEST123',
        action: 'send',
      }),
    );

    await act(async () => {
      await result.current.submit(phases, { onError });
    });

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'Network timeout' }));

    // Hash should be persisted even though submit failed
    const { intents } = useTransactionIntentStore.getState();
    expect(intents[0].status).toBe('failed');
    expect(intents[0].txHash).toBe('tx_timeout123');

    const { entries } = useActivityStore.getState();
    expect(entries[0].id).toBe('tx_timeout123');
  });

  it('should block duplicate submission with same parameters', async () => {
    const phases1: TxBuilderPhases<{ success: boolean }> = {
      build: vi
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ txHash: 'tx_abc123', signedTx: {} }), 200),
            ),
        ),
      submit: vi.fn().mockResolvedValue({ success: true }),
    };
    const phases2 = makePhases('tx_abc456', { success: true });

    const { result: result1 } = renderHook(() =>
      useIdempotentTransaction({
        chain: 'stellar',
        wallet: 'GTEST123',
        action: 'send',
        metadata: { recipient: 'st:xlm:test', amount: '10' },
      }),
    );

    act(() => {
      result1.current.submit(phases1);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const { result: result2 } = renderHook(() =>
      useIdempotentTransaction({
        chain: 'stellar',
        wallet: 'GTEST123',
        action: 'send',
        metadata: { recipient: 'st:xlm:test', amount: '10' },
      }),
    );

    await act(async () => {
      await result2.current.submit(phases2);
    });

    expect(phases2.build).not.toHaveBeenCalled();

    await waitFor(() => expect(result1.current.isSubmitting).toBe(false));
    expect(phases1.build).toHaveBeenCalledTimes(1);
  });

  it('should allow retry after failure', async () => {
    const phases: TxBuilderPhases<{ success: boolean }> = {
      build: vi
        .fn()
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ txHash: 'tx_abc123', signedTx: {} }),
      submit: vi.fn().mockResolvedValue({ success: true }),
    };

    const { result } = renderHook(() =>
      useIdempotentTransaction({
        chain: 'stellar',
        wallet: 'GTEST123',
        action: 'send',
        metadata: { recipient: 'st:xlm:test', amount: '10' },
      }),
    );

    await act(async () => {
      await result.current.submit(phases, { onError: () => {} });
    });

    expect(phases.build).toHaveBeenCalledTimes(1);
    const { intents: intentsAfterFail } = useTransactionIntentStore.getState();
    expect(intentsAfterFail[0].status).toBe('failed');

    act(() => {
      result.current.reset();
    });

    await act(async () => {
      await result.current.submit(phases);
    });

    expect(phases.build).toHaveBeenCalledTimes(2);
    const { intents } = useTransactionIntentStore.getState();
    expect(intents.length).toBe(2);
    expect(intents[0].status).toBe('confirmed');
  });

  it('should call onSuccess callback with result', async () => {
    const mockResult = { success: true, data: 'test' };
    const phases = makePhases('tx_abc123', mockResult);
    const onSuccess = vi.fn();

    const { result } = renderHook(() =>
      useIdempotentTransaction({
        chain: 'stellar',
        wallet: 'GTEST123',
        action: 'send',
      }),
    );

    await act(async () => {
      await result.current.submit(phases, { onSuccess });
    });

    expect(onSuccess).toHaveBeenCalledWith(mockResult);
  });

  it('should handle page reload scenario with existing pending intent', async () => {
    const { createIntent, updateIntentStatus } = useTransactionIntentStore.getState();

    const existingIntentId = createIntent({
      chain: 'stellar',
      wallet: 'GTEST123',
      action: 'send',
      metadata: { recipient: 'st:xlm:test', amount: '10' },
    });
    updateIntentStatus(existingIntentId, 'submitting');

    const phases = makePhases('tx_new', { success: true });

    const { result } = renderHook(() =>
      useIdempotentTransaction({
        chain: 'stellar',
        wallet: 'GTEST123',
        action: 'send',
        metadata: { recipient: 'st:xlm:test', amount: '10' },
      }),
    );

    await act(async () => {
      await result.current.submit(phases);
    });

    expect(phases.build).not.toHaveBeenCalled();
  });

  it('should reconcile sent-but-timeout transactions', async () => {
    const mockTxHash = 'tx_timeout123';

    // build succeeds (hash is persisted), submit times out
    const phases: TxBuilderPhases<{ success: boolean }> = {
      build: vi.fn().mockResolvedValue({ txHash: mockTxHash, signedTx: {} }),
      submit: vi
        .fn()
        .mockImplementation(
          () =>
            new Promise((_, reject) => setTimeout(() => reject(new Error('Network timeout')), 100)),
        ),
    };

    const mockReconcile = vi.fn().mockResolvedValue(true);

    const { result } = renderHook(() =>
      useIdempotentTransaction({
        chain: 'stellar',
        wallet: 'GTEST123',
        action: 'send',
        metadata: { recipient: 'st:xlm:test', amount: '10' },
      }),
    );

    await act(async () => {
      await result.current.submit(phases, {
        reconcile: mockReconcile,
        onSuccess: () => {},
        onError: () => {},
      });
    });

    // Reconcile must be called with the hash from the build phase
    expect(mockReconcile).toHaveBeenCalledWith(mockTxHash);

    // Both intent and activity should be confirmed, not failed
    const { intents } = useTransactionIntentStore.getState();
    expect(intents[0].status).toBe('confirmed');

    const { entries } = useActivityStore.getState();
    expect(entries[0].status).toBe('confirmed');
  });
});
