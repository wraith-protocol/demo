import { describe, expect, it, vi } from 'vitest';
import {
  createOfflineEntry,
  type OfflineQueueEntry,
  type PaymentIntentPayload,
  type ScanSessionPayload,
} from './offlineQueue';
import {
  defaultReconcileHandlers,
  reconcileOfflineQueue,
  validatePaymentIntentLocal,
  validateScanSessionLocal,
  type ReconcileHandlers,
} from './offlineReconcile';

const NOW = 1_700_000_000_000;

function intentEntry(overrides: Partial<PaymentIntentPayload> = {}): OfflineQueueEntry {
  return createOfflineEntry(
    'payment-intent',
    {
      chain: 'stellar',
      recipient: 'st:xlm:test',
      amount: '10',
      source: 'form',
      ...overrides,
    },
    NOW - 1000,
  );
}

function scanEntry(rawText = 'st:xlm:test'): OfflineQueueEntry {
  return createOfflineEntry(
    'scan-session',
    { source: 'camera', rawText, capturedAt: NOW - 1000 },
    NOW - 1000,
  );
}

function signedEntry(createdAt: number = NOW - 1000): OfflineQueueEntry {
  return createOfflineEntry(
    'signed-submit',
    { chain: 'stellar', txHash: 'hash-1', signedXdr: 'AAAA' },
    createdAt,
  );
}

function ctx(overrides: Partial<Parameters<typeof reconcileOfflineQueue>[1]> = {}) {
  return {
    now: NOW,
    isOnline: () => true,
    handlers: defaultReconcileHandlers,
    ...overrides,
  };
}

describe('reconcileOfflineQueue', () => {
  it('is a no-op while offline', async () => {
    const entries = [intentEntry()];
    const next = await reconcileOfflineQueue(entries, ctx({ isOnline: () => false }));
    expect(next).toEqual(entries);
    expect(next[0].attempts).toBe(0);
  });

  it('moves a valid payment intent to needs-review (never auto-signs)', async () => {
    const checkPaymentIntent = vi.fn(async () => ({ ok: true }) as const);
    const next = await reconcileOfflineQueue(
      [intentEntry()],
      ctx({ handlers: { ...defaultReconcileHandlers, checkPaymentIntent } }),
    );
    expect(checkPaymentIntent).toHaveBeenCalledTimes(1);
    expect(next[0].status).toBe('needs-review');
  });

  it('marks expired intents as conflict', async () => {
    const next = await reconcileOfflineQueue([intentEntry({ expiresAt: NOW - 1 })], ctx());
    expect(next[0].status).toBe('conflict');
    expect(next[0].conflictReason).toBe('expired');
  });

  it('marks intents with bad recipients as conflict', async () => {
    const next = await reconcileOfflineQueue([intentEntry({ recipient: 'nope' })], ctx());
    expect(next[0].status).toBe('conflict');
    expect(next[0].conflictReason).toBe('invalid-recipient');
  });

  it('completes valid scans and delivers the payload', async () => {
    const onScanReady = vi.fn();
    const next = await reconcileOfflineQueue(
      [scanEntry()],
      ctx({ handlers: { ...defaultReconcileHandlers, onScanReady } }),
    );
    expect(next[0].status).toBe('done');
    expect(onScanReady).toHaveBeenCalledTimes(1);
    expect(onScanReady.mock.calls[0][1]).toMatchObject({ metaAddress: 'st:xlm:test' });
  });

  it('conflicts unparseable scans instead of dropping them', async () => {
    const next = await reconcileOfflineQueue([scanEntry('definitely not a payload')], ctx());
    expect(next[0].status).toBe('conflict');
    expect(next[0].conflictReason).toBe('unparseable-scan');
  });

  it('conflicts scans whose payment-link expiry passed', async () => {
    const exp = Math.floor((NOW - 60_000) / 1000);
    const next = await reconcileOfflineQueue(
      [scanEntry(`https://example.com/pay?to=st:xlm:test&exp=${exp}`)],
      ctx(),
    );
    expect(next[0].status).toBe('conflict');
    expect(next[0].conflictReason).toBe('expired');
  });

  it('holds fresh signed envelopes for review without broadcasting', async () => {
    const handlers: ReconcileHandlers = {
      ...defaultReconcileHandlers,
      checkPaymentIntent: vi.fn(async () => ({ ok: true }) as const),
    };
    const next = await reconcileOfflineQueue([signedEntry()], ctx({ handlers }));
    expect(next[0].status).toBe('needs-review');
    // No broadcast handler exists by design — nothing could have submitted it.
    expect(handlers.checkPaymentIntent).not.toHaveBeenCalled();
  });

  it('conflicts stale signed envelopes instead of broadcasting them', async () => {
    const next = await reconcileOfflineQueue([signedEntry(NOW - 25 * 60 * 60 * 1000)], ctx());
    expect(next[0].status).toBe('conflict');
    expect(next[0].conflictReason).toBe('stale-envelope');
  });

  it('fails entries past their attempt budget', async () => {
    const entry = { ...intentEntry(), attempts: 5, maxAttempts: 5 };
    const next = await reconcileOfflineQueue([entry], ctx());
    expect(next[0].status).toBe('failed');
    expect(next[0].lastError).toBe('max-attempts-exceeded');
  });

  it('leaves terminal entries untouched and preserves order', async () => {
    const doneScan = { ...scanEntry(), status: 'done' as const };
    const entries = [doneScan, intentEntry()];
    const next = await reconcileOfflineQueue(entries, ctx());
    expect(next[0]).toEqual(doneScan);
    expect(next[1].status).toBe('needs-review');
  });

  it('turns a throwing scan consumer into a conflict, not a crash', async () => {
    const onScanReady = vi.fn(async () => {
      throw new Error('form gone');
    });
    const next = await reconcileOfflineQueue(
      [scanEntry()],
      ctx({ handlers: { ...defaultReconcileHandlers, onScanReady } }),
    );
    expect(next[0].status).toBe('conflict');
    expect(next[0].lastError).toBe('form gone');
  });
});

describe('local validators', () => {
  it('accepts well-formed intents', async () => {
    await expect(
      validatePaymentIntentLocal(
        { chain: 'stellar', recipient: 'st:xlm:test', amount: '1.5', source: 'form' },
        NOW,
      ),
    ).resolves.toEqual({ ok: true });
  });

  it('accepts parseable scans', async () => {
    const payload: ScanSessionPayload = {
      source: 'image',
      rawText: 'stellar:pay?to=st:xlm:test&amount=2',
      capturedAt: NOW,
    };
    await expect(validateScanSessionLocal(payload, NOW)).resolves.toMatchObject({
      ok: true,
      payload: { metaAddress: 'st:xlm:test', amount: '2' },
    });
  });
});
