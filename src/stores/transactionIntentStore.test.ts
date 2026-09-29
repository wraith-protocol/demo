import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useTransactionIntentStore } from './transactionIntentStore';

describe('transactionIntentStore', () => {
  beforeEach(() => {
    // Reset store before each test
    useTransactionIntentStore.setState({ intents: [] });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create a new intent', () => {
    const { createIntent, getIntent } = useTransactionIntentStore.getState();

    const intentId = createIntent({
      chain: 'stellar',
      wallet: 'GTEST123',
      action: 'send',
      metadata: { recipient: 'st:xlm:test', amount: '10' },
    });

    const intent = getIntent(intentId);
    expect(intent).toBeDefined();
    expect(intent?.status).toBe('pending');
    expect(intent?.action).toBe('send');
  });

  it('should prevent duplicate intents with same parameters', () => {
    const { createIntent, getIntent } = useTransactionIntentStore.getState();

    const params = {
      chain: 'stellar',
      wallet: 'GTEST123',
      action: 'send' as const,
      metadata: { recipient: 'st:xlm:test', amount: '10' },
    };

    const intentId1 = createIntent(params);
    const intentId2 = createIntent(params);

    // Should return same intent ID
    expect(intentId1).toBe(intentId2);

    // Should only have one intent
    const { intents } = useTransactionIntentStore.getState();
    expect(intents.length).toBe(1);
  });

  it('should allow new intent after previous one is confirmed', () => {
    const { createIntent, updateIntentStatus } = useTransactionIntentStore.getState();

    const params = {
      chain: 'stellar',
      wallet: 'GTEST123',
      action: 'send' as const,
      metadata: { recipient: 'st:xlm:test', amount: '10' },
    };

    const intentId1 = createIntent(params);
    updateIntentStatus(intentId1, 'confirmed');

    const intentId2 = createIntent(params);

    // Should create new intent
    expect(intentId2).not.toBe(intentId1);

    const { intents } = useTransactionIntentStore.getState();
    expect(intents.length).toBe(2);
  });

  it('should update intent status', () => {
    const { createIntent, updateIntentStatus, getIntent } = useTransactionIntentStore.getState();

    const intentId = createIntent({
      chain: 'stellar',
      wallet: 'GTEST123',
      action: 'send',
    });

    updateIntentStatus(intentId, 'signing');
    expect(getIntent(intentId)?.status).toBe('signing');

    updateIntentStatus(intentId, 'submitting');
    expect(getIntent(intentId)?.status).toBe('submitting');

    updateIntentStatus(intentId, 'confirmed');
    expect(getIntent(intentId)?.status).toBe('confirmed');
  });

  it('should set transaction hash', () => {
    const { createIntent, setIntentTxHash, getIntent } = useTransactionIntentStore.getState();

    const intentId = createIntent({
      chain: 'stellar',
      wallet: 'GTEST123',
      action: 'send',
    });

    const txHash = 'abc123def456';
    setIntentTxHash(intentId, txHash);

    expect(getIntent(intentId)?.txHash).toBe(txHash);
  });

  it('should cleanup expired intents', () => {
    const { createIntent, cleanupExpired, intents } = useTransactionIntentStore.getState();

    const intentId = createIntent({
      chain: 'stellar',
      wallet: 'GTEST123',
      action: 'send',
    });

    // Fast-forward time by 6 minutes (past 5 minute expiry)
    vi.advanceTimersByTime(6 * 60 * 1000);

    cleanupExpired();

    const intent = useTransactionIntentStore.getState().getIntent(intentId);
    expect(intent?.status).toBe('abandoned');
  });

  it('should find pending intent with same parameters', () => {
    const { createIntent, findPendingIntent } = useTransactionIntentStore.getState();

    const params = {
      chain: 'stellar',
      wallet: 'GTEST123',
      action: 'send' as const,
      metadata: { recipient: 'st:xlm:test', amount: '10' },
    };

    const intentId = createIntent(params);
    const foundIntent = findPendingIntent(params);

    expect(foundIntent).toBeDefined();
    expect(foundIntent?.id).toBe(intentId);
  });

  it('should not find pending intent with different parameters', () => {
    const { createIntent, findPendingIntent } = useTransactionIntentStore.getState();

    createIntent({
      chain: 'stellar',
      wallet: 'GTEST123',
      action: 'send',
      metadata: { recipient: 'st:xlm:test', amount: '10' },
    });

    const foundIntent = findPendingIntent({
      chain: 'stellar',
      wallet: 'GTEST123',
      action: 'send',
      metadata: { recipient: 'st:xlm:other', amount: '20' },
    });

    expect(foundIntent).toBeUndefined();
  });

  it('should abandon intent manually', () => {
    const { createIntent, abandonIntent, getIntent } = useTransactionIntentStore.getState();

    const intentId = createIntent({
      chain: 'stellar',
      wallet: 'GTEST123',
      action: 'send',
    });

    abandonIntent(intentId);

    expect(getIntent(intentId)?.status).toBe('abandoned');
  });

  it('should handle wallet rejection gracefully', () => {
    const { createIntent, updateIntentStatus, getIntent } = useTransactionIntentStore.getState();

    const intentId = createIntent({
      chain: 'stellar',
      wallet: 'GTEST123',
      action: 'send',
    });

    updateIntentStatus(intentId, 'signing');
    updateIntentStatus(intentId, 'failed', 'User rejected signature');

    const intent = getIntent(intentId);
    expect(intent?.status).toBe('failed');
    expect(intent?.error).toBe('User rejected signature');
  });

  it('should handle network timeout scenario', () => {
    const { createIntent, updateIntentStatus, getIntent } = useTransactionIntentStore.getState();

    const intentId = createIntent({
      chain: 'stellar',
      wallet: 'GTEST123',
      action: 'send',
    });

    updateIntentStatus(intentId, 'signing');
    updateIntentStatus(intentId, 'submitting');

    // Simulate timeout
    vi.advanceTimersByTime(30 * 1000); // 30 seconds

    updateIntentStatus(intentId, 'failed', 'Network timeout');

    const intent = getIntent(intentId);
    expect(intent?.status).toBe('failed');
    expect(intent?.error).toBe('Network timeout');
  });

  it('should prevent duplicate submission during retry', () => {
    const { createIntent, updateIntentStatus, findPendingIntent } =
      useTransactionIntentStore.getState();

    const params = {
      chain: 'stellar',
      wallet: 'GTEST123',
      action: 'send' as const,
      metadata: { recipient: 'st:xlm:test', amount: '10' },
    };

    // First attempt
    const intentId1 = createIntent(params);
    updateIntentStatus(intentId1, 'submitting');

    // User tries to retry while first is still submitting
    const pendingIntent = findPendingIntent(params);
    expect(pendingIntent).toBeDefined();
    expect(pendingIntent?.id).toBe(intentId1);

    // Should not create new intent
    const intentId2 = createIntent(params);
    expect(intentId2).toBe(intentId1);
  });
});
