import { describe, expect, it } from 'vitest';
import {
  MAX_OFFLINE_QUEUE_ITEMS,
  addEntry,
  actionableEntries,
  classifyOfflineWork,
  createOfflineEntry,
  isOfflineEntry,
  isSafeToQueue,
  isTerminalStatus,
  loadOfflineQueue,
  pendingEntries,
  requiresExplicitReview,
  saveOfflineQueue,
  type OfflineQueueEntry,
  type PaymentIntentPayload,
} from './offlineQueue';

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

function intent(overrides: Partial<PaymentIntentPayload> = {}): PaymentIntentPayload {
  return {
    chain: 'stellar',
    recipient: 'st:xlm:test',
    amount: '10',
    source: 'form',
    ...overrides,
  };
}

describe('classifyOfflineWork', () => {
  it('marks scans and intents safe-to-queue', () => {
    expect(classifyOfflineWork('payment-intent')).toBe('safe-to-queue');
    expect(classifyOfflineWork('scan-session')).toBe('safe-to-queue');
    expect(isSafeToQueue('payment-intent')).toBe(true);
    expect(isSafeToQueue('scan-session')).toBe(true);
  });

  it('marks signed submits signing-required', () => {
    expect(classifyOfflineWork('signed-submit')).toBe('signing-required');
    expect(isSafeToQueue('signed-submit')).toBe(false);
    expect(requiresExplicitReview('signed-submit')).toBe(true);
    expect(requiresExplicitReview('payment-intent')).toBe(false);
  });
});

describe('createOfflineEntry', () => {
  it('derives the policy from the kind and starts queued', () => {
    const entry = createOfflineEntry('signed-submit', {
      chain: 'stellar',
      txHash: 'abc',
      signedXdr: 'AAAA',
    });
    expect(entry.policy).toBe('signing-required');
    expect(entry.status).toBe('queued');
    expect(entry.attempts).toBe(0);
    expect(entry.id.length).toBeGreaterThan(0);
  });
});

describe('isOfflineEntry', () => {
  it('accepts a well-formed entry', () => {
    expect(isOfflineEntry(createOfflineEntry('payment-intent', intent()))).toBe(true);
  });

  it('rejects tampered policy that would auto-complete signing work', () => {
    const entry = createOfflineEntry('signed-submit', {
      chain: 'stellar',
      txHash: 'abc',
      signedXdr: 'AAAA',
    });
    expect(isOfflineEntry({ ...entry, policy: 'safe-to-queue' })).toBe(false);
  });

  it.each([null, undefined, 42, 'nope', [], { kind: 'payment-intent' }])(
    'rejects malformed values (%s)',
    (value) => {
      expect(isOfflineEntry(value)).toBe(false);
    },
  );
});

describe('persistence', () => {
  it('round-trips entries through versioned storage', () => {
    const storage = new MemoryStorage();
    const entries = [
      createOfflineEntry('payment-intent', intent(), 1000),
      createOfflineEntry('scan-session', {
        source: 'camera',
        rawText: 'st:xlm:test',
        capturedAt: 1000,
      }),
    ];
    saveOfflineQueue(storage, entries);
    expect(loadOfflineQueue(storage)).toEqual(entries);
  });

  it('drops invalid entries on load', () => {
    const storage = new MemoryStorage();
    const valid = createOfflineEntry('payment-intent', intent());
    saveOfflineQueue(storage, [valid, { kind: 'nope' } as unknown as OfflineQueueEntry]);
    // The corrupt sibling is filtered; the valid entry survives.
    expect(loadOfflineQueue(storage)).toEqual([valid]);
  });
});

describe('addEntry', () => {
  it('dedupes by id and by signed txHash', () => {
    const first = createOfflineEntry('signed-submit', {
      chain: 'stellar',
      txHash: 'same',
      signedXdr: 'AAAA',
    });
    const dupe = { ...first };
    expect(addEntry([first], dupe)).toEqual([first]);

    const sameTx = createOfflineEntry('signed-submit', {
      chain: 'stellar',
      txHash: 'same',
      signedXdr: 'BBBB',
    });
    expect(addEntry([first], sameTx)).toEqual([first]);
  });

  it('prunes oldest terminal entries past the cap, never actionable work first', () => {
    const terminal = (id: string, updatedAt: number): OfflineQueueEntry => ({
      ...createOfflineEntry('scan-session', { source: 'camera', rawText: 'x', capturedAt: 0 }),
      id,
      status: 'done',
      updatedAt,
    });
    const full = Array.from({ length: MAX_OFFLINE_QUEUE_ITEMS }, (_, i) =>
      terminal(`done-${i}`, i),
    );
    const fresh = createOfflineEntry('payment-intent', intent());
    const next = addEntry(full, fresh);
    expect(next).toHaveLength(MAX_OFFLINE_QUEUE_ITEMS);
    expect(next.some((e) => e.id === 'done-0')).toBe(false);
    expect(next.some((e) => e.id === fresh.id)).toBe(true);
  });
});

describe('selectors', () => {
  it('splits pending, actionable, and terminal entries', () => {
    const queued = createOfflineEntry('payment-intent', intent());
    const review = { ...queued, id: 'r', status: 'needs-review' as const };
    const conflict = { ...queued, id: 'c', status: 'conflict' as const };
    const done = { ...queued, id: 'd', status: 'done' as const };
    const entries = [review, done, conflict, queued];

    expect(pendingEntries(entries).map((e) => e.id)).toEqual([queued.id]);
    expect(
      actionableEntries(entries)
        .map((e) => e.id)
        .sort(),
    ).toEqual(['c', 'r']);
    expect(isTerminalStatus('done')).toBe(true);
    expect(isTerminalStatus('queued')).toBe(false);
  });
});
