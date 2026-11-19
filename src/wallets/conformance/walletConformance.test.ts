import { describe, expect, it } from 'vitest';
import { CONFORMANCE_CHAINS } from './adapters';
import {
  WalletTransitionHarness,
  type ConformanceOperation,
  type ConformanceTransition,
} from './harness';

const OPERATIONS: ConformanceOperation[] = ['simulate', 'sign', 'scan', 'submit'];
const TRANSITIONS: ConformanceTransition[] = [
  'disconnect',
  'account-change',
  'network-change',
  'provider-replacement',
];

function expectContextChanged(promise: Promise<unknown>, reason: ConformanceTransition) {
  return expect(promise).rejects.toMatchObject({
    code: 'WALLET_CONTEXT_CHANGED',
    reason,
  });
}

describe.each(CONFORMANCE_CHAINS)('$chain wallet transition conformance', (spec) => {
  it('routes operations through this chain\u2019s provider methods', async () => {
    const harness = new WalletTransitionHarness(spec);

    await harness.run('scan');

    expect(harness.provider.requestNames).toEqual([spec.requests.scan]);
    expect(harness.provider.calls).toEqual(['scan']);
  });

  it.each(OPERATIONS)(
    'cancels an in-flight %s for every wallet transition without a stale result',
    async (operation) => {
      for (const transition of TRANSITIONS) {
        const harness = new WalletTransitionHarness(spec);
        const gate = harness.provider.delayNext(operation);
        const pending = harness.run(operation);

        await gate.started;
        harness.transition(transition);
        gate.release();

        await expectContextChanged(pending, transition);
        expect(harness.session.pendingOperations).toBe(0);
      }
    },
  );

  it.each(TRANSITIONS.filter((transition) => transition !== 'disconnect'))(
    'never submits after %s while signing is in flight',
    async (transition) => {
      const harness = new WalletTransitionHarness(spec);
      const gate = harness.provider.delayNext('sign');
      const pending = harness.signAndSubmit();

      await gate.started;
      harness.transition(transition);
      gate.release();

      await expectContextChanged(pending, transition);
      expect(harness.provider.calls).toEqual(['sign']);
      expect(harness.provider.calls).not.toContain('submit');
    },
  );

  it('drops a delayed signing response after disconnect', async () => {
    const harness = new WalletTransitionHarness(spec);
    const gate = harness.provider.delayNext('sign');
    const pending = harness.signAndSubmit();

    await gate.started;
    harness.transition('disconnect');
    gate.release();

    await expectContextChanged(pending, 'disconnect');
    expect(harness.provider.calls).not.toContain('submit');
  });

  it('requires fresh confirmation when the signing policy asks for it', async () => {
    const harness = new WalletTransitionHarness(spec);
    const gate = harness.provider.delayNext('sign');
    const pending = harness.signAndSubmit('confirm');

    await gate.started;
    harness.transition('account-change');
    gate.release();

    await expect(pending).rejects.toMatchObject({
      code: 'WALLET_CONFIRMATION_REQUIRED',
      reason: 'account-change',
    });
    expect(harness.provider.calls).not.toContain('submit');
  });

  it('does not submit when the provider rejects the request', async () => {
    const harness = new WalletTransitionHarness(spec);
    harness.provider.rejectNext('sign', 'User rejected the request');

    await expect(harness.signAndSubmit()).rejects.toThrow('User rejected the request');
    expect(harness.provider.calls).toEqual(['sign']);
    expect(harness.provider.calls).not.toContain('submit');
  });

  it('clears cached balances and activity when the wallet context changes', async () => {
    const harness = new WalletTransitionHarness(spec);
    harness.cache.set('balance', '12.5');
    harness.cache.set('activity', 'tx-1');

    expect(harness.cache.get('balance')).toBe('12.5');
    expect(harness.cache.get('activity')).toBe('tx-1');

    harness.transition('network-change');

    expect(harness.cache.get('balance')).toBeUndefined();
    expect(harness.cache.get('activity')).toBeUndefined();
  });

  it('keeps a cache entry from leaking into a replaced provider session', () => {
    const harness = new WalletTransitionHarness(spec);
    harness.cache.set('balance', '3');

    harness.session.update(harness.session.identity, { providerReplaced: true });

    expect(harness.cache.get('balance')).toBeUndefined();
  });
});
