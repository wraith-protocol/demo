/**
 * workerProtocol.ts
 *
 * Validated message protocol for worker ↔ main thread communication.
 *
 * This module defines a strict, type-safe protocol for all messages exchanged
 * between the service worker(s) and the main thread. It includes:
 *
 * - Discriminated unions for all message types (request, success, error, retention-gap, progress)
 * - Runtime validation functions for inbound messages
 * - Request ID generation and tracking
 * - Stale response filtering
 * - Malformed message handling
 *
 * All messages must be validated before processing. Unknown or malformed messages
 * are logged and ignored, preventing crashes and security issues.
 */

// ─── Request ID Generation ─────────────────────────────────────────────────────

let requestIdCounter = 0;

/**
 * Generate a unique request ID for tracking async worker operations.
 * IDs are monotonic within the session and encoded as strings for JSON serialization.
 */
export function generateRequestId(): string {
  return `req-${++requestIdCounter}`;
}

/**
 * Extract the numeric sequence from a request ID for comparison.
 * Returns -1 for invalid IDs.
 */
export function requestIdSequence(id: string): number {
  const match = id.match(/^req-(\d+)$/);
  return match ? parseInt(match[1], 10) : -1;
}

// ─── Message Type Discriminators ───────────────────────────────────────────────

/**
 * Direction: main thread → worker (requests)
 */
export type WorkerRequest =
  | { type: 'SKIP_WAITING' }
  | {
      type: 'RECOVER_SCAN_CURSOR';
      requestId: string;
      publicKey: string;
      oldestAvailableLedger: number;
    }
  | {
      type: 'REGISTER_VIEWING_KEY';
      requestId: string;
      publicKey: string;
      encryptedViewingKey: string;
      encryptedSpendingPubKey: string;
      encryptedSpendingScalar: string;
    }
  | { type: 'UNREGISTER_VIEWING_KEY'; requestId: string; publicKey: string }
  | { type: 'TRIGGER_SCAN'; requestId: string }
  | {
      type: 'REGISTER_PUSH_SUBSCRIPTION';
      requestId: string;
      subscription: PushSubscriptionJSON;
      metaAddressHash: string;
      relayUrl?: string;
    }
  | {
      type: 'UNREGISTER_PUSH_SUBSCRIPTION';
      requestId: string;
      subscription: PushSubscriptionJSON;
      metaAddressHash?: string;
    };

/**
 * Direction: worker → main thread (success responses)
 */
export type WorkerSuccess =
  | { type: 'VIEWING_KEY_REGISTERED'; requestId: string }
  | { type: 'VIEWING_KEY_UNREGISTERED'; requestId: string }
  | { type: 'PUSH_SUBSCRIPTION_REGISTERED'; requestId: string }
  | { type: 'PUSH_SUBSCRIPTION_UNREGISTERED'; requestId: string }
  | {
      type: 'STELLAR_SCAN_RECOVERY_COMPLETE';
      requestId: string;
      publicKey: string;
    }
  | { type: 'OFFLINE_QUEUE_FLUSH' };

/**
 * Direction: worker → main thread (error responses)
 */
export type WorkerError =
  | { type: 'VIEWING_KEY_ERROR'; requestId: string; error: string }
  | { type: 'PUSH_SUBSCRIPTION_ERROR'; requestId: string; error: string };

/**
 * Direction: worker → main thread (retention gap notifications)
 */
export type WorkerRetentionGap = {
  type: 'STELLAR_SCAN_RETENTION_GAP';
  publicKey: string;
  oldestAvailableLedger: number;
  lastScannedLedger?: number;
};

/**
 * Direction: worker → main thread (progress updates)
 */
export type WorkerProgress = never; // No progress updates currently defined

/**
 * Direction: worker → main thread (broadcast notifications)
 */
export type WorkerBroadcast =
  | {
      type: 'WRAITH_NOTIFICATION';
      channel: 'wraith-notifications';
      payload: ValidatedPushPayload;
    }
  | { type: 'NAVIGATE_TO_MATCH'; stealthAddress: string };

/**
 * Union of all valid worker → main thread messages
 */
export type WorkerMessage = WorkerSuccess | WorkerError | WorkerRetentionGap | WorkerBroadcast;

/**
 * Union of all valid main thread → worker messages
 */
export type MainThreadMessage = WorkerRequest;

// ─── Supporting Types ───────────────────────────────────────────────────────────

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface ValidatedPushPayload {
  version: 1;
  id: string;
  title: string;
  body: string;
  amount?: string;
  asset?: string;
  sender?: string;
  url: string;
}

// ─── Validation Functions ───────────────────────────────────────────────────────

/**
 * Result of message validation
 */
export type ValidationResult<T> = { valid: true; data: T } | { valid: false; reason: string };

/**
 * Validate that a value is a non-empty string of at most maxLength characters
 */
function assertString(value: unknown, field: string, maxLength: number, required = false): string {
  if (value === undefined && !required) {
    throw new Error(`${field} is missing but optional`);
  }
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  if (required && value.length === 0) {
    throw new Error(`${field} must be non-empty`);
  }
  if (value.length > maxLength) {
    throw new Error(`${field} exceeds maximum length of ${maxLength}`);
  }
  return value;
}

/**
 * Validate that a value is a safe integer within the specified range
 */
function assertInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number') {
    throw new Error(`${field} must be a number`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${field} must be a safe integer`);
  }
  if (value < min || value > max) {
    throw new Error(`${field} must be between ${min} and ${max}`);
  }
  return value;
}

/**
 * Validate a request ID format
 */
function assertRequestId(value: unknown): string {
  const id = assertString(value, 'requestId', 64, true);
  if (!/^req-\d+$/.test(id)) {
    throw new Error('requestId must match format req-{number}');
  }
  return id;
}

/**
 * Validate a PushSubscriptionJSON structure
 */
function assertPushSubscription(value: unknown): PushSubscriptionJSON {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('subscription must be an object');
  }
  const sub = value as Record<string, unknown>;
  const endpoint = assertString(sub.endpoint, 'subscription.endpoint', 512, true);
  const keys = sub.keys;
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
    throw new Error('subscription.keys must be an object');
  }
  const keysObj = keys as Record<string, unknown>;
  const p256dh = assertString(keysObj.p256dh, 'subscription.keys.p256dh', 256, true);
  const auth = assertString(keysObj.auth, 'subscription.keys.auth', 256, true);
  return { endpoint, keys: { p256dh, auth } };
}

/**
 * Validate a ValidatedPushPayload structure
 */
function assertPushPayload(value: unknown): ValidatedPushPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('payload must be an object');
  }
  const payload = value as Record<string, unknown>;
  if (payload.version !== 1) {
    throw new Error('payload.version must be 1');
  }
  const id = assertString(payload.id, 'payload.id', 128, true);
  const title = assertString(payload.title, 'payload.title', 100, true);
  const body = assertString(payload.body, 'payload.body', 500, true);
  const amount =
    payload.amount !== undefined ? assertString(payload.amount, 'payload.amount', 64) : undefined;
  const asset =
    payload.asset !== undefined ? assertString(payload.asset, 'payload.asset', 16) : undefined;
  const sender =
    payload.sender !== undefined ? assertString(payload.sender, 'payload.sender', 128) : undefined;
  const url = assertString(payload.url, 'payload.url', 256, true);
  return { version: 1, id, title, body, amount, asset, sender, url };
}

// ─── Main Thread → Worker Validation ───────────────────────────────────────────

/**
 * Validate a message from the main thread to the worker
 */
export function validateMainThreadMessage(value: unknown): ValidationResult<MainThreadMessage> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Message must be an object');
    }
    const msg = value as Record<string, unknown>;
    const type = assertString(msg.type, 'type', 64, true);

    switch (type) {
      case 'SKIP_WAITING':
        if (Object.keys(msg).length !== 1) {
          throw new Error('SKIP_WAITING message must not have extra fields');
        }
        return { valid: true, data: { type: 'SKIP_WAITING' } };

      case 'RECOVER_SCAN_CURSOR': {
        const allowedFields = ['type', 'requestId', 'publicKey', 'oldestAvailableLedger'];
        const extraFields = Object.keys(msg).filter((k) => !allowedFields.includes(k));
        if (extraFields.length > 0) {
          throw new Error(
            `RECOVER_SCAN_CURSOR message has extra fields: ${extraFields.join(', ')}`,
          );
        }
        const requestId = assertRequestId(msg.requestId);
        const publicKey = assertString(msg.publicKey, 'publicKey', 128, true);
        const oldestAvailableLedger = assertInteger(
          msg.oldestAvailableLedger,
          'oldestAvailableLedger',
          1,
          Number.MAX_SAFE_INTEGER,
        );
        return {
          valid: true,
          data: { type: 'RECOVER_SCAN_CURSOR', requestId, publicKey, oldestAvailableLedger },
        };
      }

      case 'REGISTER_VIEWING_KEY': {
        const allowedFields = [
          'type',
          'requestId',
          'publicKey',
          'encryptedViewingKey',
          'encryptedSpendingPubKey',
          'encryptedSpendingScalar',
        ];
        const extraFields = Object.keys(msg).filter((k) => !allowedFields.includes(k));
        if (extraFields.length > 0) {
          throw new Error(
            `REGISTER_VIEWING_KEY message has extra fields: ${extraFields.join(', ')}`,
          );
        }
        const requestId = assertRequestId(msg.requestId);
        const publicKey = assertString(msg.publicKey, 'publicKey', 128, true);
        const encryptedViewingKey = assertString(
          msg.encryptedViewingKey,
          'encryptedViewingKey',
          512,
          true,
        );
        const encryptedSpendingPubKey = assertString(
          msg.encryptedSpendingPubKey,
          'encryptedSpendingPubKey',
          512,
          true,
        );
        const encryptedSpendingScalar = assertString(
          msg.encryptedSpendingScalar,
          'encryptedSpendingScalar',
          512,
          true,
        );
        return {
          valid: true,
          data: {
            type: 'REGISTER_VIEWING_KEY',
            requestId,
            publicKey,
            encryptedViewingKey,
            encryptedSpendingPubKey,
            encryptedSpendingScalar,
          },
        };
      }

      case 'UNREGISTER_VIEWING_KEY': {
        const allowedFields = ['type', 'requestId', 'publicKey'];
        const extraFields = Object.keys(msg).filter((k) => !allowedFields.includes(k));
        if (extraFields.length > 0) {
          throw new Error(
            `UNREGISTER_VIEWING_KEY message has extra fields: ${extraFields.join(', ')}`,
          );
        }
        const requestId = assertRequestId(msg.requestId);
        const publicKey = assertString(msg.publicKey, 'publicKey', 128, true);
        return { valid: true, data: { type: 'UNREGISTER_VIEWING_KEY', requestId, publicKey } };
      }

      case 'TRIGGER_SCAN': {
        const allowedFields = ['type', 'requestId'];
        const extraFields = Object.keys(msg).filter((k) => !allowedFields.includes(k));
        if (extraFields.length > 0) {
          throw new Error(`TRIGGER_SCAN message has extra fields: ${extraFields.join(', ')}`);
        }
        const requestId = assertRequestId(msg.requestId);
        return { valid: true, data: { type: 'TRIGGER_SCAN', requestId } };
      }

      case 'REGISTER_PUSH_SUBSCRIPTION': {
        const allowedFields = ['type', 'requestId', 'subscription', 'metaAddressHash', 'relayUrl'];
        const extraFields = Object.keys(msg).filter((k) => !allowedFields.includes(k));
        if (extraFields.length > 0) {
          throw new Error(
            `REGISTER_PUSH_SUBSCRIPTION message has extra fields: ${extraFields.join(', ')}`,
          );
        }
        const requestId = assertRequestId(msg.requestId);
        const subscription = assertPushSubscription(msg.subscription);
        const metaAddressHash = assertString(msg.metaAddressHash, 'metaAddressHash', 128, true);
        const relayUrl =
          msg.relayUrl !== undefined ? assertString(msg.relayUrl, 'relayUrl', 512) : undefined;
        return {
          valid: true,
          data: {
            type: 'REGISTER_PUSH_SUBSCRIPTION',
            requestId,
            subscription,
            metaAddressHash,
            relayUrl,
          },
        };
      }

      case 'UNREGISTER_PUSH_SUBSCRIPTION': {
        const allowedFields = ['type', 'requestId', 'subscription', 'metaAddressHash'];
        const extraFields = Object.keys(msg).filter((k) => !allowedFields.includes(k));
        if (extraFields.length > 0) {
          throw new Error(
            `UNREGISTER_PUSH_SUBSCRIPTION message has extra fields: ${extraFields.join(', ')}`,
          );
        }
        const requestId = assertRequestId(msg.requestId);
        const subscription = assertPushSubscription(msg.subscription);
        const metaAddressHash =
          msg.metaAddressHash !== undefined
            ? assertString(msg.metaAddressHash, 'metaAddressHash', 128)
            : undefined;
        return {
          valid: true,
          data: { type: 'UNREGISTER_PUSH_SUBSCRIPTION', requestId, subscription, metaAddressHash },
        };
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : 'Unknown validation error',
    };
  }
}

// ─── Worker → Main Thread Validation ──────────────────────────────────────────

/**
 * Validate a message from the worker to the main thread
 */
export function validateWorkerMessage(value: unknown): ValidationResult<WorkerMessage> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Message must be an object');
    }
    const msg = value as Record<string, unknown>;
    const type = assertString(msg.type, 'type', 64, true);

    switch (type) {
      case 'VIEWING_KEY_REGISTERED': {
        const allowedFields = ['type', 'requestId'];
        const extraFields = Object.keys(msg).filter((k) => !allowedFields.includes(k));
        if (extraFields.length > 0) {
          throw new Error(
            `VIEWING_KEY_REGISTERED message has extra fields: ${extraFields.join(', ')}`,
          );
        }
        const requestId = assertRequestId(msg.requestId);
        return { valid: true, data: { type: 'VIEWING_KEY_REGISTERED', requestId } };
      }

      case 'VIEWING_KEY_UNREGISTERED': {
        const allowedFields = ['type', 'requestId'];
        const extraFields = Object.keys(msg).filter((k) => !allowedFields.includes(k));
        if (extraFields.length > 0) {
          throw new Error(
            `VIEWING_KEY_UNREGISTERED message has extra fields: ${extraFields.join(', ')}`,
          );
        }
        const requestId = assertRequestId(msg.requestId);
        return { valid: true, data: { type: 'VIEWING_KEY_UNREGISTERED', requestId } };
      }

      case 'PUSH_SUBSCRIPTION_REGISTERED': {
        const allowedFields = ['type', 'requestId'];
        const extraFields = Object.keys(msg).filter((k) => !allowedFields.includes(k));
        if (extraFields.length > 0) {
          throw new Error(
            `PUSH_SUBSCRIPTION_REGISTERED message has extra fields: ${extraFields.join(', ')}`,
          );
        }
        const requestId = assertRequestId(msg.requestId);
        return { valid: true, data: { type: 'PUSH_SUBSCRIPTION_REGISTERED', requestId } };
      }

      case 'PUSH_SUBSCRIPTION_UNREGISTERED': {
        const allowedFields = ['type', 'requestId'];
        const extraFields = Object.keys(msg).filter((k) => !allowedFields.includes(k));
        if (extraFields.length > 0) {
          throw new Error(
            `PUSH_SUBSCRIPTION_UNREGISTERED message has extra fields: ${extraFields.join(', ')}`,
          );
        }
        const requestId = assertRequestId(msg.requestId);
        return { valid: true, data: { type: 'PUSH_SUBSCRIPTION_UNREGISTERED', requestId } };
      }

      case 'VIEWING_KEY_ERROR': {
        const allowedFields = ['type', 'requestId', 'error'];
        const extraFields = Object.keys(msg).filter((k) => !allowedFields.includes(k));
        if (extraFields.length > 0) {
          throw new Error(`VIEWING_KEY_ERROR message has extra fields: ${extraFields.join(', ')}`);
        }
        const requestId = assertRequestId(msg.requestId);
        const error = assertString(msg.error, 'error', 512, true);
        return { valid: true, data: { type: 'VIEWING_KEY_ERROR', requestId, error } };
      }

      case 'PUSH_SUBSCRIPTION_ERROR': {
        const allowedFields = ['type', 'requestId', 'error'];
        const extraFields = Object.keys(msg).filter((k) => !allowedFields.includes(k));
        if (extraFields.length > 0) {
          throw new Error(
            `PUSH_SUBSCRIPTION_ERROR message has extra fields: ${extraFields.join(', ')}`,
          );
        }
        const requestId = assertRequestId(msg.requestId);
        const error = assertString(msg.error, 'error', 512, true);
        return { valid: true, data: { type: 'PUSH_SUBSCRIPTION_ERROR', requestId, error } };
      }

      case 'STELLAR_SCAN_RECOVERY_COMPLETE': {
        const allowedFields = ['type', 'requestId', 'publicKey'];
        const extraFields = Object.keys(msg).filter((k) => !allowedFields.includes(k));
        if (extraFields.length > 0) {
          throw new Error(
            `STELLAR_SCAN_RECOVERY_COMPLETE message has extra fields: ${extraFields.join(', ')}`,
          );
        }
        const requestId = assertRequestId(msg.requestId);
        const publicKey = assertString(msg.publicKey, 'publicKey', 128, true);
        return {
          valid: true,
          data: { type: 'STELLAR_SCAN_RECOVERY_COMPLETE', requestId, publicKey },
        };
      }

      case 'STELLAR_SCAN_RETENTION_GAP': {
        const allowedFields = ['type', 'publicKey', 'oldestAvailableLedger', 'lastScannedLedger'];
        const extraFields = Object.keys(msg).filter((k) => !allowedFields.includes(k));
        if (extraFields.length > 0) {
          throw new Error(
            `STELLAR_SCAN_RETENTION_GAP message has extra fields: ${extraFields.join(', ')}`,
          );
        }
        const publicKey = assertString(msg.publicKey, 'publicKey', 128, true);
        const oldestAvailableLedger = assertInteger(
          msg.oldestAvailableLedger,
          'oldestAvailableLedger',
          1,
          Number.MAX_SAFE_INTEGER,
        );
        const lastScannedLedger =
          msg.lastScannedLedger !== undefined
            ? assertInteger(msg.lastScannedLedger, 'lastScannedLedger', 1, Number.MAX_SAFE_INTEGER)
            : undefined;
        return {
          valid: true,
          data: {
            type: 'STELLAR_SCAN_RETENTION_GAP',
            publicKey,
            oldestAvailableLedger,
            lastScannedLedger,
          },
        };
      }

      case 'OFFLINE_QUEUE_FLUSH':
        if (Object.keys(msg).length !== 1) {
          throw new Error('OFFLINE_QUEUE_FLUSH message must not have extra fields');
        }
        return { valid: true, data: { type: 'OFFLINE_QUEUE_FLUSH' } };

      case 'WRAITH_NOTIFICATION': {
        const allowedFields = ['type', 'channel', 'payload'];
        const extraFields = Object.keys(msg).filter((k) => !allowedFields.includes(k));
        if (extraFields.length > 0) {
          throw new Error(
            `WRAITH_NOTIFICATION message has extra fields: ${extraFields.join(', ')}`,
          );
        }
        const channel = assertString(msg.channel, 'channel', 64, true);
        if (channel !== 'wraith-notifications') {
          throw new Error('channel must be wraith-notifications');
        }
        const payload = assertPushPayload(msg.payload);
        return { valid: true, data: { type: 'WRAITH_NOTIFICATION', channel, payload } };
      }

      case 'NAVIGATE_TO_MATCH': {
        const allowedFields = ['type', 'stealthAddress'];
        const extraFields = Object.keys(msg).filter((k) => !allowedFields.includes(k));
        if (extraFields.length > 0) {
          throw new Error(`NAVIGATE_TO_MATCH message has extra fields: ${extraFields.join(', ')}`);
        }
        const stealthAddress = assertString(msg.stealthAddress, 'stealthAddress', 128, true);
        return { valid: true, data: { type: 'NAVIGATE_TO_MATCH', stealthAddress } };
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof Error ? error.message : 'Unknown validation error',
    };
  }
}

// ─── Request ID Tracking ───────────────────────────────────────────────────────

/**
 * Track pending requests and filter stale responses
 */
export class RequestTracker {
  private pending = new Map<string, number>();

  /**
   * Register a request ID as pending
   */
  register(requestId: string): void {
    this.pending.set(requestId, Date.now());
  }

  /**
   * Unregister a request ID after receiving a response
   */
  unregister(requestId: string): void {
    this.pending.delete(requestId);
  }

  /**
   * Check if a request ID is still pending (not yet responded to)
   */
  isPending(requestId: string): boolean {
    return this.pending.has(requestId);
  }

  /**
   * Clear all pending requests (e.g., on page navigation or SW restart)
   */
  clear(): void {
    this.pending.clear();
  }

  /**
   * Get the count of pending requests
   */
  size(): number {
    return this.pending.size;
  }
}

/**
 * Global request tracker instance for the main thread
 */
export const mainThreadRequestTracker = new RequestTracker();
