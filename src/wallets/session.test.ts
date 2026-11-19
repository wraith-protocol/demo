import { describe, expect, it, vi } from 'vitest';
import {
  WalletConfirmationRequiredError,
  WalletContextChangedError,
  WalletNotConnectedError,
  WalletScopedCache,
  WalletSession,
  providerInstanceId,
  sameWalletIdentity,
  type WalletIdentity,
} from './session';

const baseline: WalletIdentity = {
  chain: 'stellar',
  provider: 'freighter',
  account: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  network: 'testnet',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('WalletSession', () => {
  it('classifies the identity transitions that matter', () => {
    const session = new WalletSession(baseline);

    expect(session.update({ ...baseline, account: 'GOTHER' })).toMatchObject({
      reason: 'account-change',
    });
    expect(session.update({ ...baseline, account: 'GOTHER', network: 'mainnet' })).toMatchObject({
      reason: 'network-change',
    });
    expect(
      session.update({
        ...baseline,
        account: 'GOTHER',
        network: 'mainnet',
        provider: 'albedo',
      }),
    ).toMatchObject({ reason: 'provider-replacement' });
    expect(session.update(null)).toMatchObject({ reason: 'disconnect' });
    expect(session.update(baseline)).toMatchObject({ reason: 'connect' });
    expect(session.update(baseline)).toBeNull();
  });

  it('refuses to begin an operation without a connected wallet', () => {
    const session = new WalletSession(null);

    expect(() => session.begin('sign')).toThrow(WalletNotConnectedError);
  });

  it('cancels an in-flight operation when the account changes', async () => {
    const session = new WalletSession(baseline);
    const gate = deferred<string>();

    const pending = session.run('sign', async (operation) => {
      const signed = await gate.promise;
      operation.assertActive();
      return signed;
    });

    session.update({ ...baseline, account: 'GOTHER' });
    gate.resolve('signed');

    await expect(pending).rejects.toMatchObject({
      code: 'WALLET_CONTEXT_CHANGED',
      reason: 'account-change',
    });
    expect(session.pendingOperations).toBe(0);
  });

  it('does not let a stale signed response reach submission', async () => {
    const session = new WalletSession(baseline);
    const gate = deferred<string>();
    const submit = vi.fn();

    const pending = session.run('send', async (operation) => {
      const signed = await gate.promise;
      operation.assertActive();
      submit(signed);
      return signed;
    });

    session.update({ ...baseline, network: 'mainnet' });
    gate.resolve('signed');

    await expect(pending).rejects.toMatchObject({
      code: 'WALLET_CONTEXT_CHANGED',
      reason: 'network-change',
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it('reports a fresh confirmation requirement instead of a hard cancellation', async () => {
    const session = new WalletSession(baseline);
    const gate = deferred<string>();

    const pending = session.run(
      'sign',
      async (operation) => {
        const signed = await gate.promise;
        operation.assertActive();
        return signed;
      },
      { policy: 'confirm' },
    );

    session.update({ ...baseline, provider: 'albedo' });
    gate.resolve('signed');

    await expect(pending).rejects.toBeInstanceOf(WalletConfirmationRequiredError);
  });

  it('invalidates in-flight work when the provider instance is replaced', async () => {
    const session = new WalletSession(baseline);
    const gate = deferred<string>();

    const pending = session.run('sign', async (operation) => {
      const signed = await gate.promise;
      operation.assertActive();
      return signed;
    });

    session.update(baseline, { providerReplaced: true });
    gate.resolve('signed');

    await expect(pending).rejects.toBeInstanceOf(WalletContextChangedError);
  });

  it('notifies subscribers and can invalidate operations explicitly', () => {
    const session = new WalletSession(baseline);
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);

    session.update({ ...baseline, account: 'GOTHER' });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ reason: 'account-change' }));

    session.invalidate('provider-replacement');
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'provider-replacement' }),
    );

    unsubscribe();
    session.update(null);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('only treats fully matching identities as current', () => {
    expect(sameWalletIdentity(baseline, { ...baseline })).toBe(true);
    expect(sameWalletIdentity(baseline, null)).toBe(false);
    expect(sameWalletIdentity(null, null)).toBe(true);
    expect(sameWalletIdentity(baseline, { ...baseline, provider: 'albedo' })).toBe(false);
  });

  it('assigns provider instance ids that change when the instance is replaced', () => {
    const first = {};
    const second = {};

    expect(providerInstanceId(first)).toBe(providerInstanceId(first));
    expect(providerInstanceId(second)).not.toBe(providerInstanceId(first));
    expect(providerInstanceId(null)).toBe('none');
  });
});

describe('WalletScopedCache', () => {
  it('drops cached balances and activity when the account changes', () => {
    const session = new WalletSession(baseline);
    const cache = new WalletScopedCache<string>(session);

    expect(cache.set('balance', '10')).toBe(true);
    expect(cache.set('activity', 'tx-1')).toBe(true);
    expect(cache.get('balance')).toBe('10');

    session.update({ ...baseline, account: 'GOTHER' });

    expect(cache.get('balance')).toBeUndefined();
    expect(cache.get('activity')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('refuses to store entries while disconnected', () => {
    const session = new WalletSession(null);
    const cache = new WalletScopedCache<string>(session);

    expect(cache.set('balance', '10')).toBe(false);
    expect(cache.get('balance')).toBeUndefined();
  });

  it('clears on provider replacement even when the identity strings match', () => {
    const session = new WalletSession(baseline);
    const cache = new WalletScopedCache<string>(session);

    cache.set('balance', '10');
    session.update(baseline, { providerReplaced: true });

    expect(cache.get('balance')).toBeUndefined();
  });
});
