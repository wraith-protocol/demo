// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanKeyBackend } from '@/sw/scanKeyStore';
import { scanPages } from '@/sw/backgroundScan';
import { MemoryScanKeyBackend } from '@/sw/testing/memoryScanKeyBackend';

const holder = vi.hoisted(() => ({ backend: undefined as ScanKeyBackend | undefined }));

vi.mock('@/sw/idbScanKeyBackend', () => ({
  createIdbScanKeyBackend: () => holder.backend,
}));
vi.mock('@/context/StellarWalletContext', async () => {
  const { createContext } = await import('react');
  return { StellarWalletContext: createContext(null) };
});

import { StellarWalletContext } from '@/context/StellarWalletContext';
import { StealthKeysProvider, useStealthKeys } from './StealthKeysContext';

const ACCOUNT = 'GTESTACCOUNT';

let disconnect: (() => void) | undefined;
const wallet = {
  subscribeToDisconnect: (listener: () => void) => {
    disconnect = listener;
    return () => {
      if (disconnect === listener) disconnect = undefined;
    };
  },
};

let ctx!: ReturnType<typeof useStealthKeys>;
function Probe() {
  ctx = useStealthKeys();
  return null;
}

function mountApp() {
  return render(
    <StellarWalletContext.Provider value={wallet as never}>
      <StealthKeysProvider>
        <Probe />
      </StealthKeysProvider>
    </StellarWalletContext.Provider>,
  );
}

let backend: MemoryScanKeyBackend;
const unlocked = async () => (await backend.getWrappingKey(ACCOUNT)) !== undefined;

beforeEach(async () => {
  backend = new MemoryScanKeyBackend();
  holder.backend = backend;
  vi.stubGlobal('indexedDB', {});
  disconnect = undefined;
  // A registered account: sealed blob + wrapping key (contents are irrelevant to locking).
  await backend.putSealed(
    {
      publicKey: ACCOUNT,
      version: 1,
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array(32),
      sealedAt: 0,
    },
    {} as CryptoKey,
  );
});

describe('scan-key lock lifecycle', () => {
  it('wallet disconnect locks the scan key and the worker can no longer scan', async () => {
    mountApp();
    expect(await unlocked()).toBe(true);

    act(() => disconnect!());

    await vi.waitFor(async () => expect(await unlocked()).toBe(false));
    expect(await backend.getRecord(ACCOUNT)).toBeDefined(); // blob stays, but it is inert

    const readPages = vi.fn(async () => {});
    const commit = vi.fn(async () => {});
    const result = await scanPages({
      backend,
      publicKey: ACCOUNT,
      readPages,
      commit,
      notifyMatch: vi.fn(async () => {}),
    });
    expect(result).toEqual({ status: 'locked' });
    expect(readPages).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('the app idle re-lock (clearStellar) locks the scan key', async () => {
    mountApp();
    act(() => {
      ctx.clearStellar();
    });
    await vi.waitFor(async () => expect(await unlocked()).toBe(false));
  });

  it('recovery mode keeps its keys, so it does not lock the scan key', async () => {
    mountApp();
    act(() => ctx.setIsRecoveryMode(true));
    act(() => disconnect!());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await unlocked()).toBe(true);
  });

  it('leaving recovery mode locks the scan key', async () => {
    mountApp();
    act(() => ctx.setIsRecoveryMode(true));
    act(() => {
      ctx.exitRecoveryMode();
    });
    await vi.waitFor(async () => expect(await unlocked()).toBe(false));
  });
});
