import { act, cleanup, renderHook } from '@testing-library/react';
import type { TFunction } from 'i18next';
import type { MatchedAnnouncement, StealthKeys } from '@wraith-protocol/sdk/chains/stellar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStellarScanner } from './useStellarScanner';

vi.mock('@/lib/stellar/deployments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/stellar/deployments')>();
  return {
    ...actual,
    getStellarContractId: () => 'C'.repeat(56),
  };
});

vi.mock('@/lib/telemetry', () => ({
  trackEvent: vi.fn(),
}));

const t = ((key: string) => key) as TFunction;

const keys: StealthKeys = {
  spendingKey: new Uint8Array(32).fill(1),
  spendingScalar: 1n,
  viewingKey: new Uint8Array(32).fill(2),
  viewingScalar: 2n,
  spendingPubKey: new Uint8Array(32).fill(3),
  viewingPubKey: new Uint8Array(32).fill(4),
};

const match: MatchedAnnouncement = {
  schemeId: 1,
  stealthAddress: 'GSTEALTH',
  caller: 'GCALLER',
  ephemeralPubKey: 'aa'.repeat(32),
  metadata: '00',
  stealthPrivateScalar: 3n,
  stealthPubKeyBytes: new Uint8Array(32).fill(5),
};

class FakeWorker {
  static instances: FakeWorker[] = [];
  terminate = vi.fn();
  postMessage = vi.fn();
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeWorker.instances.push(this);
  }

  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}

const originalWorker = globalThis.Worker;

describe('useStellarScanner', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    globalThis.Worker = FakeWorker as unknown as typeof Worker;
    window.localStorage.clear();
  });

  afterEach(() => {
    globalThis.Worker = originalWorker;
    cleanup();
  });

  it('runs an initial scan and accepts a typed SUCCESS message', async () => {
    const { result } = renderHook(() =>
      useStellarScanner({ stellarKeys: keys, address: 'GWALLET', strategy: 'fast', t }),
    );

    await act(async () => {
      await result.current.scan();
    });

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: 'fast', startLedger: undefined }),
    );
    expect(result.current.isScanning).toBe(true);

    act(() => {
      FakeWorker.instances[0].emit({
        type: 'SUCCESS',
        results: [match],
        nextLedger: 101,
        committedLedger: 100,
        pages: 1,
        truncated: false,
      });
    });

    expect(result.current.matched).toEqual([match]);
    expect(result.current.hasScanned).toBe(true);
    expect(result.current.isScanning).toBe(false);
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();
  });

  it('appends PAGE matches and commits the cursor incrementally', async () => {
    const { result } = renderHook(() =>
      useStellarScanner({ stellarKeys: keys, address: 'GWALLET', strategy: 'balanced', t }),
    );

    await act(async () => {
      await result.current.scan();
    });

    act(() => {
      FakeWorker.instances[0].emit({
        type: 'PAGE',
        page: 1,
        committedLedger: 199,
        events: 2,
        undecodableEvents: 0,
        matched: [match],
      });
    });

    expect(result.current.matched).toEqual([match]);
    expect(window.localStorage.getItem('wraith-stellar-scan-cursor:GWALLET')).toBe('200');
    expect(result.current.isScanning).toBe(true);
  });

  it('reports a retention gap and rescans from the oldest safe ledger', async () => {
    const { result } = renderHook(() =>
      useStellarScanner({ stellarKeys: keys, address: 'GWALLET', strategy: 'full', t }),
    );

    await act(async () => {
      await result.current.scan();
    });

    act(() => {
      FakeWorker.instances[0].emit({
        type: 'RETENTION_GAP',
        requestedLedger: 100,
        oldestAvailableLedger: 250,
      });
    });

    expect(result.current.retentionGap).toEqual({
      requestedLedger: 100,
      oldestAvailableLedger: 250,
    });

    await act(async () => {
      result.current.recoverRetentionGap();
    });

    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[1].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 250 }),
    );
  });

  it('terminates the active worker on cancellation', async () => {
    const { result } = renderHook(() =>
      useStellarScanner({ stellarKeys: keys, address: 'GWALLET', strategy: 'fast', t }),
    );

    await act(async () => {
      await result.current.scan();
    });

    act(() => {
      result.current.cancel();
    });

    expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();
    expect(result.current.isScanning).toBe(false);
  });

  it('surfaces worker failures', async () => {
    const { result } = renderHook(() =>
      useStellarScanner({ stellarKeys: keys, address: 'GWALLET', strategy: 'fast', t }),
    );

    await act(async () => {
      await result.current.scan();
    });

    act(() => {
      FakeWorker.instances[0].emit({ type: 'ERROR', error: 'rpc unavailable' });
    });

    expect(result.current.error).toBe('rpc unavailable');
    expect(result.current.isScanning).toBe(false);
  });

  it('rejects malformed worker messages without trusting their payload', async () => {
    const { result } = renderHook(() =>
      useStellarScanner({ stellarKeys: keys, address: 'GWALLET', strategy: 'fast', t }),
    );

    await act(async () => {
      await result.current.scan();
    });

    act(() => {
      FakeWorker.instances[0].emit({
        type: 'SUCCESS',
        results: [{ stealthAddress: 'GSTEALTH' }],
        nextLedger: 101,
        committedLedger: 100,
        pages: 1,
        truncated: false,
      });
    });

    expect(result.current.error).toBe('common.scanFailed');
    expect(result.current.matched).toEqual([]);
  });
});
