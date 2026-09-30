import { describe, expect, it } from 'vitest';
import {
  MAX_OFFLINE_QUEUE_ITEMS,
  addEntry,
  actionableEntries,
  classifyOfflineWork,
  createOfflineEntry,
  enforceQueueCap,
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

function actionable(id: string, updatedAt = 0): OfflineQueueEntry {
  return {
    ...createOfflineEntry('payment-intent', intent(), updatedAt),
    id,
    status: 'queued',
    updatedAt,
  };
}

function terminal(id: string, updatedAt: number): OfflineQueueEntry {
  return {
    ...createOfflineEntry('scan-session', { source: 'camera', rawText: 'x', capturedAt: 0 }),
    id,
    status: 'done',
    updatedAt,
  };
}

describe('addEntry', () => {
  it('dedupes by id and by signed txHash', () => {
    const first = createOfflineEntry('signed-submit', {
      chain: 'stellar',
      txHash: 'same',
      signedXdr: 'AAAA',
    });
    const dupe = { ...first };
    expect(addEntry([first], dupe)).toEqual({ entries: [first], accepted: true, evicted: 0 });

    const sameTx = createOfflineEntry('signed-submit', {
      chain: 'stellar',
      txHash: 'same',
      signedXdr: 'BBBB',
    });
    expect(addEntry([first], sameTx)).toEqual({ entries: [first], accepted: true, evicted: 0 });
  });

  it('prunes oldest terminal entries past the cap, never actionable work first', () => {
    const full = Array.from({ length: MAX_OFFLINE_QUEUE_ITEMS }, (_, i) =>
      terminal(`done-${i}`, i),
    );
    const fresh = createOfflineEntry('payment-intent', intent());
    const result = addEntry(full, fresh);
    expect(result.accepted).toBe(true);
    expect(result.evicted).toBe(1);
    expect(result.entries).toHaveLength(MAX_OFFLINE_QUEUE_ITEMS);
    expect(result.entries.some((e) => e.id === 'done-0')).toBe(false);
    expect(result.entries.some((e) => e.id === fresh.id)).toBe(true);
  });

  it('rejects explicitly when the queue is full of actionable work', () => {
    const full = Array.from({ length: MAX_OFFLINE_QUEUE_ITEMS }, (_, i) =>
      actionable(`queued-${i}`, i),
    );
    const fresh = createOfflineEntry('payment-intent', intent());
    const result = addEntry(full, fresh);
    expect(result.accepted).toBe(false);
    expect(result.evicted).toBe(0);
    // Untouched: still exactly the original 50, new item absent — nothing
    // silently dropped, nothing silently truncated.
    expect(result.entries).toHaveLength(MAX_OFFLINE_QUEUE_ITEMS);
    expect(result.entries).toEqual(full);
    expect(result.entries.some((e) => e.id === fresh.id)).toBe(false);
    expect(result.entries.every((e) => e.status === 'queued')).toBe(true);
  });

  it('rejects oversized corrupt state with no terminals without mutating it', () => {
    const oversized = Array.from({ length: MAX_OFFLINE_QUEUE_ITEMS + 1 }, (_, i) =>
      actionable(`queued-${i}`, i),
    );
    const fresh = createOfflineEntry('payment-intent', intent());
    const result = addEntry(oversized, fresh);
    expect(result.accepted).toBe(false);
    expect(result.entries).toEqual(oversized);
  });

  it('accepts when a single terminal entry can be evicted', () => {
    const entries = [
      ...Array.from({ length: MAX_OFFLINE_QUEUE_ITEMS - 1 }, (_, i) =>
        actionable(`queued-${i}`, i),
      ),
      terminal('done-old', 0),
    ];
    const fresh = createOfflineEntry('payment-intent', intent());
    const result = addEntry(entries, fresh);
    expect(result.accepted).toBe(true);
    expect(result.evicted).toBe(1);
    expect(result.entries).toHaveLength(MAX_OFFLINE_QUEUE_ITEMS);
    expect(result.entries.some((e) => e.id === 'done-old')).toBe(false);
    expect(result.entries.some((e) => e.id === fresh.id)).toBe(true);
  });
});

describe('enforceQueueCap', () => {
  it('leaves fitting queues untouched', () => {
    const entries = [actionable('a-1'), terminal('d-1', 1)];
    expect(enforceQueueCap(entries)).toEqual({
      entries,
      droppedTerminal: 0,
      droppedNewest: 0,
    });
  });

  it('prunes oldest terminals from oversized loaded state', () => {
    const entries = [
      ...Array.from({ length: MAX_OFFLINE_QUEUE_ITEMS - 1 }, (_, i) =>
        actionable(`queued-${i}`, i),
      ),
      terminal('done-old', 0),
      terminal('done-older', -1),
      terminal('done-new', 999),
    ];
    expect(entries).toHaveLength(MAX_OFFLINE_QUEUE_ITEMS + 2);
    const result = enforceQueueCap(entries);
    expect(result.entries).toHaveLength(MAX_OFFLINE_QUEUE_ITEMS);
    expect(result.droppedTerminal).toBe(2);
    expect(result.droppedNewest).toBe(0);
    expect(result.entries.some((e) => e.id === 'done-new')).toBe(true);
    expect(result.entries.some((e) => e.id === 'done-old')).toBe(false);
    expect(result.entries.some((e) => e.id === 'done-older')).toBe(false);
  });

  it('keeps the oldest entries when actionable work alone exceeds the cap', () => {
    const entries = Array.from({ length: MAX_OFFLINE_QUEUE_ITEMS + 3 }, (_, i) =>
      actionable(`queued-${i}`, i),
    );
    const result = enforceQueueCap(entries);
    expect(result.entries).toHaveLength(MAX_OFFLINE_QUEUE_ITEMS);
    expect(result.droppedTerminal).toBe(0);
    expect(result.droppedNewest).toBe(3);
    expect(result.entries[0].id).toBe('queued-0');
  });
});

describe('saveOfflineQueue', () => {
  it('persists exactly what it is given — no silent tail truncation', () => {
    const storage = new MemoryStorage();
    // 51 valid entries: producers own the cap, so the save path must not
    // decide which one disappears.
    const entries = Array.from({ length: MAX_OFFLINE_QUEUE_ITEMS + 1 }, (_, i) =>
      actionable(`queued-${i}`, i),
    );
    saveOfflineQueue(storage, entries);
    expect(loadOfflineQueue(storage)).toEqual(entries);
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
