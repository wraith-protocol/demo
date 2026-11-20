/**
 * workerProtocol.test.ts
 *
 * Tests for the validated worker message protocol.
 *
 * Covers:
 * - Message validation for all message types
 * - Malformed message handling
 * - Unknown message type handling
 * - Request ID generation and tracking
 * - Stale response filtering
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateRequestId,
  requestIdSequence,
  validateMainThreadMessage,
  validateWorkerMessage,
  RequestTracker,
  mainThreadRequestTracker,
  type MainThreadMessage,
  type WorkerMessage,
} from './workerProtocol';

describe('workerProtocol', () => {
  beforeEach(() => {
    mainThreadRequestTracker.clear();
  });

  describe('requestIdSequence', () => {
    it('extracts sequence from valid request ID', () => {
      expect(requestIdSequence('req-123')).toBe(123);
      expect(requestIdSequence('req-0')).toBe(0);
      expect(requestIdSequence('req-999999')).toBe(999999);
    });

    it('returns -1 for invalid request IDs', () => {
      expect(requestIdSequence('invalid')).toBe(-1);
      expect(requestIdSequence('req-')).toBe(-1);
      expect(requestIdSequence('req-abc')).toBe(-1);
      expect(requestIdSequence('')).toBe(-1);
    });
  });

  describe('generateRequestId', () => {
    it('generates unique, monotonic request IDs', () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();
      const id3 = generateRequestId();

      expect(id1).toMatch(/^req-\d+$/);
      expect(id2).toMatch(/^req-\d+$/);
      expect(id3).toMatch(/^req-\d+$/);
      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(requestIdSequence(id1)).toBeLessThan(requestIdSequence(id2));
      expect(requestIdSequence(id2)).toBeLessThan(requestIdSequence(id3));
    });
  });

  describe('RequestTracker', () => {
    it('tracks pending requests', () => {
      const tracker = new RequestTracker();
      const id = 'req-1';

      expect(tracker.isPending(id)).toBe(false);
      tracker.register(id);
      expect(tracker.isPending(id)).toBe(true);
      tracker.unregister(id);
      expect(tracker.isPending(id)).toBe(false);
    });

    it('clears all pending requests', () => {
      const tracker = new RequestTracker();
      tracker.register('req-1');
      tracker.register('req-2');
      tracker.register('req-3');

      expect(tracker.size()).toBe(3);
      tracker.clear();
      expect(tracker.size()).toBe(0);
      expect(tracker.isPending('req-1')).toBe(false);
      expect(tracker.isPending('req-2')).toBe(false);
      expect(tracker.isPending('req-3')).toBe(false);
    });
  });

  describe('validateMainThreadMessage', () => {
    describe('SKIP_WAITING', () => {
      it('validates correct SKIP_WAITING message', () => {
        const msg = { type: 'SKIP_WAITING' };
        const result = validateMainThreadMessage(msg);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.data).toEqual(msg);
        }
      });

      it('rejects SKIP_WAITING with extra fields', () => {
        const msg = { type: 'SKIP_WAITING', extra: 'field' };
        const result = validateMainThreadMessage(msg);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('extra fields');
        }
      });
    });

    describe('RECOVER_SCAN_CURSOR', () => {
      it('validates correct RECOVER_SCAN_CURSOR message', () => {
        const msg: MainThreadMessage = {
          type: 'RECOVER_SCAN_CURSOR',
          requestId: 'req-1',
          publicKey: 'GABC123...XYZ',
          oldestAvailableLedger: 1000,
        };
        const result = validateMainThreadMessage(msg);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.data).toEqual(msg);
        }
      });

      it('rejects RECOVER_SCAN_CURSOR with invalid requestId', () => {
        const msg = {
          type: 'RECOVER_SCAN_CURSOR',
          requestId: 'invalid',
          publicKey: 'GABC123...XYZ',
          oldestAvailableLedger: 1000,
        };
        const result = validateMainThreadMessage(msg);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('requestId');
        }
      });

      it('rejects RECOVER_SCAN_CURSOR with missing publicKey', () => {
        const msg = {
          type: 'RECOVER_SCAN_CURSOR',
          requestId: 'req-1',
          oldestAvailableLedger: 1000,
        };
        const result = validateMainThreadMessage(msg);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('publicKey');
        }
      });

      it('rejects RECOVER_SCAN_CURSOR with invalid ledger', () => {
        const msg = {
          type: 'RECOVER_SCAN_CURSOR',
          requestId: 'req-1',
          publicKey: 'GABC123...XYZ',
          oldestAvailableLedger: -1,
        };
        const result = validateMainThreadMessage(msg);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('oldestAvailableLedger');
        }
      });
    });

    describe('REGISTER_VIEWING_KEY', () => {
      it('validates correct REGISTER_VIEWING_KEY message', () => {
        const msg: MainThreadMessage = {
          type: 'REGISTER_VIEWING_KEY',
          requestId: 'req-1',
          publicKey: 'GABC123...XYZ',
          encryptedViewingKey: 'encrypted-key-1',
          encryptedSpendingPubKey: 'encrypted-key-2',
          encryptedSpendingScalar: 'encrypted-key-3',
        };
        const result = validateMainThreadMessage(msg);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.data).toEqual(msg);
        }
      });

      it('rejects REGISTER_VIEWING_KEY with missing encrypted fields', () => {
        const msg = {
          type: 'REGISTER_VIEWING_KEY',
          requestId: 'req-1',
          publicKey: 'GABC123...XYZ',
        };
        const result = validateMainThreadMessage(msg);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('encryptedViewingKey');
        }
      });

      it('rejects REGISTER_VIEWING_KEY with extra fields', () => {
        const msg = {
          type: 'REGISTER_VIEWING_KEY',
          requestId: 'req-1',
          publicKey: 'GABC123...XYZ',
          encryptedViewingKey: 'encrypted-key-1',
          encryptedSpendingPubKey: 'encrypted-key-2',
          encryptedSpendingScalar: 'encrypted-key-3',
          extra: 'field',
        };
        const result = validateMainThreadMessage(msg);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('extra fields');
        }
      });
    });

    describe('UNREGISTER_VIEWING_KEY', () => {
      it('validates correct UNREGISTER_VIEWING_KEY message', () => {
        const msg: MainThreadMessage = {
          type: 'UNREGISTER_VIEWING_KEY',
          requestId: 'req-1',
          publicKey: 'GABC123...XYZ',
        };
        const result = validateMainThreadMessage(msg);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.data).toEqual(msg);
        }
      });

      it('rejects UNREGISTER_VIEWING_KEY with extra fields', () => {
        const msg = {
          type: 'UNREGISTER_VIEWING_KEY',
          requestId: 'req-1',
          publicKey: 'GABC123...XYZ',
          extra: 'field',
        };
        const result = validateMainThreadMessage(msg);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('extra fields');
        }
      });
    });

    describe('TRIGGER_SCAN', () => {
      it('validates correct TRIGGER_SCAN message', () => {
        const msg: MainThreadMessage = {
          type: 'TRIGGER_SCAN',
          requestId: 'req-1',
        };
        const result = validateMainThreadMessage(msg);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.data).toEqual(msg);
        }
      });

      it('rejects TRIGGER_SCAN with extra fields', () => {
        const msg = {
          type: 'TRIGGER_SCAN',
          requestId: 'req-1',
          extra: 'field',
        };
        const result = validateMainThreadMessage(msg);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('extra fields');
        }
      });
    });

    describe('REGISTER_PUSH_SUBSCRIPTION', () => {
      it('validates correct REGISTER_PUSH_SUBSCRIPTION message', () => {
        const msg: MainThreadMessage = {
          type: 'REGISTER_PUSH_SUBSCRIPTION',
          requestId: 'req-1',
          subscription: {
            endpoint: 'https://push.example.com',
            keys: {
              p256dh: 'p256dh-key',
              auth: 'auth-key',
            },
          },
          metaAddressHash: 'hash123',
          relayUrl: 'https://relay.example.com',
        };
        const result = validateMainThreadMessage(msg);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.data).toEqual(msg);
        }
      });

      it('rejects REGISTER_PUSH_SUBSCRIPTION with invalid subscription', () => {
        const msg = {
          type: 'REGISTER_PUSH_SUBSCRIPTION',
          requestId: 'req-1',
          subscription: 'invalid',
          metaAddressHash: 'hash123',
        };
        const result = validateMainThreadMessage(msg);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('subscription');
        }
      });

      it('rejects REGISTER_PUSH_SUBSCRIPTION with extra fields', () => {
        const msg = {
          type: 'REGISTER_PUSH_SUBSCRIPTION',
          requestId: 'req-1',
          subscription: {
            endpoint: 'https://push.example.com',
            keys: {
              p256dh: 'p256dh-key',
              auth: 'auth-key',
            },
          },
          metaAddressHash: 'hash123',
          extra: 'field',
        };
        const result = validateMainThreadMessage(msg);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('extra fields');
        }
      });
    });

    describe('UNREGISTER_PUSH_SUBSCRIPTION', () => {
      it('validates correct UNREGISTER_PUSH_SUBSCRIPTION message', () => {
        const msg: MainThreadMessage = {
          type: 'UNREGISTER_PUSH_SUBSCRIPTION',
          requestId: 'req-1',
          subscription: {
            endpoint: 'https://push.example.com',
            keys: {
              p256dh: 'p256dh-key',
              auth: 'auth-key',
            },
          },
        };
        const result = validateMainThreadMessage(msg);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.data).toEqual(msg);
        }
      });

      it('rejects UNREGISTER_PUSH_SUBSCRIPTION with extra fields', () => {
        const msg = {
          type: 'UNREGISTER_PUSH_SUBSCRIPTION',
          requestId: 'req-1',
          subscription: {
            endpoint: 'https://push.example.com',
            keys: {
              p256dh: 'p256dh-key',
              auth: 'auth-key',
            },
          },
          extra: 'field',
        };
        const result = validateMainThreadMessage(msg);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('extra fields');
        }
      });
    });

    describe('malformed messages', () => {
      it('rejects null', () => {
        const result = validateMainThreadMessage(null);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('object');
        }
      });

      it('rejects undefined', () => {
        const result = validateMainThreadMessage(undefined);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('object');
        }
      });

      it('rejects array', () => {
        const result = validateMainThreadMessage([]);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('object');
        }
      });

      it('rejects string', () => {
        const result = validateMainThreadMessage('invalid');
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('object');
        }
      });

      it('rejects number', () => {
        const result = validateMainThreadMessage(123);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('object');
        }
      });

      it('rejects message without type', () => {
        const result = validateMainThreadMessage({ data: 'test' });
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('type');
        }
      });

      it('rejects message with unknown type', () => {
        const result = validateMainThreadMessage({ type: 'UNKNOWN_TYPE' });
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('Unknown message type');
        }
      });
    });
  });

  describe('validateWorkerMessage', () => {
    describe('VIEWING_KEY_REGISTERED', () => {
      it('validates correct VIEWING_KEY_REGISTERED message', () => {
        const msg: WorkerMessage = {
          type: 'VIEWING_KEY_REGISTERED',
          requestId: 'req-1',
        };
        const result = validateWorkerMessage(msg);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.data).toEqual(msg);
        }
      });

      it('rejects VIEWING_KEY_REGISTERED with extra fields', () => {
        const msg = {
          type: 'VIEWING_KEY_REGISTERED',
          requestId: 'req-1',
          extra: 'field',
        };
        const result = validateWorkerMessage(msg);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('extra fields');
        }
      });
    });

    describe('VIEWING_KEY_ERROR', () => {
      it('validates correct VIEWING_KEY_ERROR message', () => {
        const msg: WorkerMessage = {
          type: 'VIEWING_KEY_ERROR',
          requestId: 'req-1',
          error: 'Something went wrong',
        };
        const result = validateWorkerMessage(msg);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.data).toEqual(msg);
        }
      });

      it('rejects VIEWING_KEY_ERROR without error', () => {
        const msg = {
          type: 'VIEWING_KEY_ERROR',
          requestId: 'req-1',
        };
        const result = validateWorkerMessage(msg);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('error');
        }
      });
    });

    describe('STELLAR_SCAN_RETENTION_GAP', () => {
      it('validates correct STELLAR_SCAN_RETENTION_GAP message', () => {
        const msg: WorkerMessage = {
          type: 'STELLAR_SCAN_RETENTION_GAP',
          publicKey: 'GABC123...XYZ',
          oldestAvailableLedger: 1000,
          lastScannedLedger: 500,
        };
        const result = validateWorkerMessage(msg);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.data).toEqual(msg);
        }
      });

      it('validates STELLAR_SCAN_RETENTION_GAP without lastScannedLedger', () => {
        const msg: WorkerMessage = {
          type: 'STELLAR_SCAN_RETENTION_GAP',
          publicKey: 'GABC123...XYZ',
          oldestAvailableLedger: 1000,
        };
        const result = validateWorkerMessage(msg);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.data).toEqual(msg);
        }
      });
    });

    describe('WRAITH_NOTIFICATION', () => {
      it('validates correct WRAITH_NOTIFICATION message', () => {
        const msg: WorkerMessage = {
          type: 'WRAITH_NOTIFICATION',
          channel: 'wraith-notifications',
          payload: {
            version: 1,
            id: 'notif-123',
            title: 'Payment Received',
            body: 'You received 10 XLM',
            amount: '10',
            asset: 'XLM',
            url: '/notifications',
          },
        };
        const result = validateWorkerMessage(msg);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.data).toEqual(msg);
        }
      });

      it('rejects WRAITH_NOTIFICATION with wrong channel', () => {
        const msg = {
          type: 'WRAITH_NOTIFICATION',
          channel: 'wrong-channel',
          payload: {
            version: 1,
            id: 'notif-123',
            title: 'Payment Received',
            body: 'You received 10 XLM',
            url: '/notifications',
          },
        };
        const result = validateWorkerMessage(msg);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('channel');
        }
      });

      it('rejects WRAITH_NOTIFICATION with invalid payload', () => {
        const msg = {
          type: 'WRAITH_NOTIFICATION',
          channel: 'wraith-notifications',
          payload: 'invalid',
        };
        const result = validateWorkerMessage(msg);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('payload');
        }
      });

      it('rejects WRAITH_NOTIFICATION with extra fields', () => {
        const msg = {
          type: 'WRAITH_NOTIFICATION',
          channel: 'wraith-notifications',
          payload: {
            version: 1,
            id: 'notif-123',
            title: 'Payment Received',
            body: 'You received 10 XLM',
            url: '/notifications',
          },
          extra: 'field',
        };
        const result = validateWorkerMessage(msg);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('extra fields');
        }
      });
    });

    describe('OFFLINE_QUEUE_FLUSH', () => {
      it('validates correct OFFLINE_QUEUE_FLUSH message', () => {
        const msg: WorkerMessage = {
          type: 'OFFLINE_QUEUE_FLUSH',
        };
        const result = validateWorkerMessage(msg);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.data).toEqual(msg);
        }
      });

      it('rejects OFFLINE_QUEUE_FLUSH with extra fields', () => {
        const msg = {
          type: 'OFFLINE_QUEUE_FLUSH',
          extra: 'field',
        };
        const result = validateWorkerMessage(msg);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('extra fields');
        }
      });
    });

    describe('NAVIGATE_TO_MATCH', () => {
      it('validates correct NAVIGATE_TO_MATCH message', () => {
        const msg: WorkerMessage = {
          type: 'NAVIGATE_TO_MATCH',
          stealthAddress: 'GABC123...XYZ',
        };
        const result = validateWorkerMessage(msg);
        expect(result.valid).toBe(true);
        if (result.valid) {
          expect(result.data).toEqual(msg);
        }
      });

      it('rejects NAVIGATE_TO_MATCH with extra fields', () => {
        const msg = {
          type: 'NAVIGATE_TO_MATCH',
          stealthAddress: 'GABC123...XYZ',
          extra: 'field',
        };
        const result = validateWorkerMessage(msg);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('extra fields');
        }
      });
    });

    describe('malformed messages', () => {
      it('rejects null', () => {
        const result = validateWorkerMessage(null);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('object');
        }
      });

      it('rejects undefined', () => {
        const result = validateWorkerMessage(undefined);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('object');
        }
      });

      it('rejects array', () => {
        const result = validateWorkerMessage([]);
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('object');
        }
      });

      it('rejects message without type', () => {
        const result = validateWorkerMessage({ data: 'test' });
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('type');
        }
      });

      it('rejects message with unknown type', () => {
        const result = validateWorkerMessage({ type: 'UNKNOWN_TYPE' });
        expect(result.valid).toBe(false);
        if (!result.valid) {
          expect(result.reason).toContain('Unknown message type');
        }
      });
    });
  });
});
