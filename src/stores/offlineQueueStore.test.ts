import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config', () => ({
  STELLAR_NETWORK: {
    horizonUrl: 'https://horizon-testnet.stellar.org',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
  },
}));

vi.mock('./activityStore', () => ({
  useActivityStore: { getState: () => ({ updateStatus: vi.fn() }) },
}));

import { MAX_OFFLINE_QUEUE_ITEMS } from '../lib/offlineQueue';
import { useOfflineQueueStore } from './offlineQueueStore';

function resetStore() {
  useOfflineQueueStore.setState({
    entries: [],
    phase: 'idle',
    lastReconciledAt: null,
    lastAppliedScan: null,
  });
}

describe('offlineQueueStore cap boundary', () => {
  beforeEach(() => {
    resetStore();
  });

  it('rejects the 51st entry when all 50 are still actionable', () => {
    const store = useOfflineQueueStore.getState();
    const accepted = Array.from({ length: MAX_OFFLINE_QUEUE_ITEMS }, (_, i) =>
      store.enqueuePaymentIntent({
        chain: 'stellar',
        recipient: `st:xlm:test-${i}`,
        amount: '10',
        source: 'form',
      }),
    );
    expect(accepted.every((e) => e !== null)).toBe(true);

    const rejected = useOfflineQueueStore.getState().enqueuePaymentIntent({
      chain: 'stellar',
      recipient: 'st:xlm:test-overflow',
      amount: '10',
      source: 'form',
    });

    // Explicit rejection: null, original 50 untouched, nothing dropped.
    expect(rejected).toBeNull();
    const entries = useOfflineQueueStore.getState().entries;
    const recipients = entries.map((e) => (e.payload as { recipient?: string }).recipient);
    expect(entries).toHaveLength(MAX_OFFLINE_QUEUE_ITEMS);
    expect(recipients).not.toContain('st:xlm:test-overflow');
    expect(recipients).toContain('st:xlm:test-0');
  });

  it('accepts again after discarding an entry', () => {
    const store = useOfflineQueueStore.getState();
    for (let i = 0; i < MAX_OFFLINE_QUEUE_ITEMS; i += 1) {
      store.enqueuePaymentIntent({
        chain: 'stellar',
        recipient: `st:xlm:test-${i}`,
        amount: '10',
        source: 'form',
      });
    }
    const [first] = useOfflineQueueStore.getState().entries;
    useOfflineQueueStore.getState().remove(first.id);

    const accepted = useOfflineQueueStore.getState().enqueuePaymentIntent({
      chain: 'stellar',
      recipient: 'st:xlm:test-after-discard',
      amount: '10',
      source: 'form',
    });
    expect(accepted).not.toBeNull();
    expect(useOfflineQueueStore.getState().entries).toHaveLength(MAX_OFFLINE_QUEUE_ITEMS);
  });
});
