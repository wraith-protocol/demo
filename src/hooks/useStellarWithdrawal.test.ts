import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { MatchedAnnouncement } from '@wraith-protocol/sdk/chains/stellar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStellarWithdrawal } from './useStellarWithdrawal';
import {
  activeTransactionReason,
  cancelPreparedUpdate,
  prepareForUpdate,
} from '@/lib/transactionActivity';
import { fetchWithRetry } from '@/lib/stellar/retry';

vi.mock('@/context/StellarWalletContext', () => ({
  useStellarWallet: () => ({
    address: 'GSPONSOR',
    signTransaction: vi.fn(),
    isNetworkMismatch: false,
  }),
}));
vi.mock('@/lib/telemetry', () => ({ trackEvent: vi.fn() }));
vi.mock('@/lib/stellar/retry', () => ({
  fetchWithRetry: vi.fn(),
  RetryExhaustedError: class extends Error {},
}));

const match: MatchedAnnouncement = {
  schemeId: 1,
  stealthAddress: 'GSTEALTH',
  caller: 'GCALLER',
  ephemeralPubKey: 'aa'.repeat(32),
  metadata: '00',
  stealthPrivateScalar: 3n,
  stealthPubKeyBytes: new Uint8Array(32).fill(5),
};

async function renderWithdrawal() {
  vi.mocked(fetchWithRetry).mockResolvedValueOnce(new Response('{}', { status: 404 }));
  const hook = renderHook(() =>
    useStellarWithdrawal({
      match,
      onBalanceFetched: vi.fn(),
      onWithdrawn: vi.fn(),
    }),
  );
  await waitFor(() => expect(hook.result.current.balanceState).toBe('loaded'));
  act(() => hook.result.current.setDest('GDESTINATION'));
  vi.mocked(fetchWithRetry).mockClear();
  return hook;
}

describe('withdrawal update protection after hook extraction', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    cancelPreparedUpdate();
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    cancelPreparedUpdate();
    expect(activeTransactionReason()).toBeNull();
  });

  it.each(['withdraw', 'sponsoredWithdraw'] as const)(
    'blocks %s while an update is preparing',
    async (method) => {
      const { result } = await renderWithdrawal();
      expect(prepareForUpdate()).toBe(true);
      await act(async () => {
        await result.current[method]();
      });
      expect(result.current.error).toContain('update is in progress');
      expect(fetchWithRetry).not.toHaveBeenCalled();
      expect(result.current.withdrawing).toBe(false);
    },
  );

  it.each(['withdraw', 'sponsoredWithdraw'] as const)(
    'keeps %s protected after unmount until its request settles',
    async (method) => {
      const { result, unmount } = await renderWithdrawal();
      let rejectRequest!: (error: Error) => void;
      vi.mocked(fetchWithRetry).mockReturnValueOnce(
        new Promise<Response>((_, reject) => {
          rejectRequest = reject;
        }),
      );
      let pending!: Promise<void>;
      act(() => {
        pending = result.current[method]();
      });
      expect(activeTransactionReason()).not.toBeNull();
      expect(prepareForUpdate()).toBe(false);
      unmount();
      expect(prepareForUpdate()).toBe(false);
      await act(async () => {
        rejectRequest(new Error('RPC unavailable'));
        await pending;
      });
      expect(activeTransactionReason()).toBeNull();
      expect(prepareForUpdate()).toBe(true);
    },
  );
});
