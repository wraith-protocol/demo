import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  validateServiceWorkerInboundMessage,
  validateServiceWorkerOutboundMessage,
  validateBroadcastChannelMessage,
  validateWebWorkerMessage,
  createMessage,
} from './messages';

// ─── helpers ─────────────────────────────────────────────────────────────────

function versioned<T extends object>(msg: T) {
  return { ...msg, version: PROTOCOL_VERSION };
}

// ─── createMessage ────────────────────────────────────────────────────────────

describe('createMessage', () => {
  it('stamps the current protocol version', () => {
    const msg = createMessage({ type: 'SKIP_WAITING' as const });
    expect(msg.version).toBe(PROTOCOL_VERSION);
    expect(msg.type).toBe('SKIP_WAITING');
  });
});

// ─── validateServiceWorkerInboundMessage ─────────────────────────────────────

describe('validateServiceWorkerInboundMessage', () => {
  it('rejects null / non-object', () => {
    expect(validateServiceWorkerInboundMessage(null).valid).toBe(false);
    expect(validateServiceWorkerInboundMessage('string').valid).toBe(false);
    expect(validateServiceWorkerInboundMessage(42).valid).toBe(false);
  });

  it('rejects a message with no version', () => {
    const result = validateServiceWorkerInboundMessage({ type: 'SKIP_WAITING' });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/version/i);
  });

  it('rejects an incompatible major version', () => {
    const result = validateServiceWorkerInboundMessage({ type: 'SKIP_WAITING', version: '0.9.0' });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/incompatible/i);
  });

  it('rejects an unknown message type', () => {
    const result = validateServiceWorkerInboundMessage(versioned({ type: 'UNKNOWN_TYPE' }));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Unknown message type/);
  });

  it('accepts SKIP_WAITING', () => {
    const result = validateServiceWorkerInboundMessage(versioned({ type: 'SKIP_WAITING' }));
    expect(result.valid).toBe(true);
    expect(result.message?.type).toBe('SKIP_WAITING');
  });

  it('accepts TRIGGER_SCAN', () => {
    expect(validateServiceWorkerInboundMessage(versioned({ type: 'TRIGGER_SCAN' })).valid).toBe(
      true,
    );
  });

  // ── RECOVER_SCAN_CURSOR ───────────────────────────────────────────────────

  it('accepts a valid RECOVER_SCAN_CURSOR message', () => {
    const result = validateServiceWorkerInboundMessage(
      versioned({ type: 'RECOVER_SCAN_CURSOR', publicKey: 'GABC', oldestAvailableLedger: 100 }),
    );
    expect(result.valid).toBe(true);
    expect(result.message?.type).toBe('RECOVER_SCAN_CURSOR');
  });

  it('rejects RECOVER_SCAN_CURSOR with missing publicKey', () => {
    const result = validateServiceWorkerInboundMessage(
      versioned({ type: 'RECOVER_SCAN_CURSOR', oldestAvailableLedger: 100 }),
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/publicKey/);
  });

  it('rejects RECOVER_SCAN_CURSOR with empty publicKey', () => {
    const result = validateServiceWorkerInboundMessage(
      versioned({ type: 'RECOVER_SCAN_CURSOR', publicKey: '', oldestAvailableLedger: 100 }),
    );
    expect(result.valid).toBe(false);
  });

  it('rejects RECOVER_SCAN_CURSOR with non-integer oldestAvailableLedger', () => {
    const result = validateServiceWorkerInboundMessage(
      versioned({ type: 'RECOVER_SCAN_CURSOR', publicKey: 'GABC', oldestAvailableLedger: 1.5 }),
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/oldestAvailableLedger/);
  });

  it('rejects RECOVER_SCAN_CURSOR with zero ledger', () => {
    const result = validateServiceWorkerInboundMessage(
      versioned({ type: 'RECOVER_SCAN_CURSOR', publicKey: 'GABC', oldestAvailableLedger: 0 }),
    );
    expect(result.valid).toBe(false);
  });

  it('rejects RECOVER_SCAN_CURSOR with string ledger', () => {
    const result = validateServiceWorkerInboundMessage(
      versioned({
        type: 'RECOVER_SCAN_CURSOR',
        publicKey: 'GABC',
        oldestAvailableLedger: '100',
      }),
    );
    expect(result.valid).toBe(false);
  });

  // ── REGISTER_VIEWING_KEY ─────────────────────────────────────────────────

  it('accepts a valid REGISTER_VIEWING_KEY message', () => {
    const result = validateServiceWorkerInboundMessage(
      versioned({
        type: 'REGISTER_VIEWING_KEY',
        publicKey: 'GABC',
        encryptedViewingKey: new ArrayBuffer(32),
        encryptedSpendingPubKey: new ArrayBuffer(32),
        encryptedSpendingScalar: new ArrayBuffer(32),
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects REGISTER_VIEWING_KEY with missing publicKey', () => {
    const result = validateServiceWorkerInboundMessage(
      versioned({
        type: 'REGISTER_VIEWING_KEY',
        encryptedViewingKey: new ArrayBuffer(32),
        encryptedSpendingPubKey: new ArrayBuffer(32),
        encryptedSpendingScalar: new ArrayBuffer(32),
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/publicKey/);
  });

  it('rejects REGISTER_VIEWING_KEY with non-string publicKey', () => {
    const result = validateServiceWorkerInboundMessage(
      versioned({
        type: 'REGISTER_VIEWING_KEY',
        publicKey: 123,
        encryptedViewingKey: new ArrayBuffer(32),
        encryptedSpendingPubKey: new ArrayBuffer(32),
        encryptedSpendingScalar: new ArrayBuffer(32),
      }),
    );
    expect(result.valid).toBe(false);
  });

  it('rejects REGISTER_VIEWING_KEY when encrypted fields are missing', () => {
    const result = validateServiceWorkerInboundMessage(
      versioned({ type: 'REGISTER_VIEWING_KEY', publicKey: 'GABC' }),
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/encryptedViewingKey/);
  });

  // ── UNREGISTER_VIEWING_KEY ───────────────────────────────────────────────

  it('accepts UNREGISTER_VIEWING_KEY', () => {
    const result = validateServiceWorkerInboundMessage(
      versioned({ type: 'UNREGISTER_VIEWING_KEY', publicKey: 'GABC' }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects UNREGISTER_VIEWING_KEY with empty publicKey', () => {
    const result = validateServiceWorkerInboundMessage(
      versioned({ type: 'UNREGISTER_VIEWING_KEY', publicKey: '' }),
    );
    expect(result.valid).toBe(false);
  });

  // ── REGISTER_PUSH_SUBSCRIPTION ───────────────────────────────────────────

  it('accepts REGISTER_PUSH_SUBSCRIPTION', () => {
    const result = validateServiceWorkerInboundMessage(
      versioned({
        type: 'REGISTER_PUSH_SUBSCRIPTION',
        subscription: { endpoint: 'https://example.com' },
        metaAddressHash: 'abc123',
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects REGISTER_PUSH_SUBSCRIPTION with missing subscription', () => {
    const result = validateServiceWorkerInboundMessage(
      versioned({ type: 'REGISTER_PUSH_SUBSCRIPTION', metaAddressHash: 'abc' }),
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/subscription/);
  });

  it('rejects REGISTER_PUSH_SUBSCRIPTION with missing metaAddressHash', () => {
    const result = validateServiceWorkerInboundMessage(
      versioned({
        type: 'REGISTER_PUSH_SUBSCRIPTION',
        subscription: { endpoint: 'https://example.com' },
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/metaAddressHash/);
  });

  // ── UNREGISTER_PUSH_SUBSCRIPTION ────────────────────────────────────────

  it('accepts UNREGISTER_PUSH_SUBSCRIPTION', () => {
    const result = validateServiceWorkerInboundMessage(
      versioned({
        type: 'UNREGISTER_PUSH_SUBSCRIPTION',
        subscription: { endpoint: 'https://example.com' },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects UNREGISTER_PUSH_SUBSCRIPTION with missing subscription', () => {
    const result = validateServiceWorkerInboundMessage(
      versioned({ type: 'UNREGISTER_PUSH_SUBSCRIPTION' }),
    );
    expect(result.valid).toBe(false);
  });
});

// ─── validateServiceWorkerOutboundMessage ────────────────────────────────────

describe('validateServiceWorkerOutboundMessage', () => {
  it('rejects missing version', () => {
    const result = validateServiceWorkerOutboundMessage({ type: 'VIEWING_KEY_REGISTERED' });
    expect(result.valid).toBe(false);
  });

  it('accepts VIEWING_KEY_REGISTERED', () => {
    expect(
      validateServiceWorkerOutboundMessage(versioned({ type: 'VIEWING_KEY_REGISTERED' })).valid,
    ).toBe(true);
  });

  it('accepts VIEWING_KEY_UNREGISTERED', () => {
    expect(
      validateServiceWorkerOutboundMessage(versioned({ type: 'VIEWING_KEY_UNREGISTERED' })).valid,
    ).toBe(true);
  });

  it('accepts VIEWING_KEY_ERROR with error string', () => {
    expect(
      validateServiceWorkerOutboundMessage(
        versioned({ type: 'VIEWING_KEY_ERROR', error: 'something went wrong' }),
      ).valid,
    ).toBe(true);
  });

  it('rejects VIEWING_KEY_ERROR without error field', () => {
    const result = validateServiceWorkerOutboundMessage(versioned({ type: 'VIEWING_KEY_ERROR' }));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/error/);
  });

  it('accepts STELLAR_SCAN_RETENTION_GAP', () => {
    const result = validateServiceWorkerOutboundMessage(
      versioned({
        type: 'STELLAR_SCAN_RETENTION_GAP',
        publicKey: 'GABC',
        oldestAvailableLedger: 500,
        requestedLedger: 450,
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects STELLAR_SCAN_RETENTION_GAP with missing ledger fields', () => {
    const result = validateServiceWorkerOutboundMessage(
      versioned({ type: 'STELLAR_SCAN_RETENTION_GAP', publicKey: 'GABC' }),
    );
    expect(result.valid).toBe(false);
  });

  it('accepts STELLAR_SCAN_RECOVERY_COMPLETE', () => {
    const result = validateServiceWorkerOutboundMessage(
      versioned({ type: 'STELLAR_SCAN_RECOVERY_COMPLETE', publicKey: 'GABC' }),
    );
    expect(result.valid).toBe(true);
  });
});

// ─── validateBroadcastChannelMessage ─────────────────────────────────────────

describe('validateBroadcastChannelMessage', () => {
  it('rejects missing version', () => {
    expect(
      validateBroadcastChannelMessage({ type: 'CONNECTED', address: 'G1', origin: 'tab1' }).valid,
    ).toBe(false);
  });

  it('accepts CONNECTED', () => {
    const result = validateBroadcastChannelMessage(
      versioned({ type: 'CONNECTED', address: 'GABC', origin: 'tab-1' }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects CONNECTED without address', () => {
    const result = validateBroadcastChannelMessage(
      versioned({ type: 'CONNECTED', origin: 'tab-1' }),
    );
    expect(result.valid).toBe(false);
  });

  it('accepts DISCONNECTED', () => {
    expect(
      validateBroadcastChannelMessage(versioned({ type: 'DISCONNECTED', origin: 'tab-1' })).valid,
    ).toBe(true);
  });

  it('rejects DISCONNECTED without origin', () => {
    expect(validateBroadcastChannelMessage(versioned({ type: 'DISCONNECTED' })).valid).toBe(false);
  });

  it('accepts NETWORK_CHANGED', () => {
    expect(
      validateBroadcastChannelMessage(
        versioned({
          type: 'NETWORK_CHANGED',
          passphrase: 'Test SDF Network ; September 2015',
          origin: 'tab-1',
        }),
      ).valid,
    ).toBe(true);
  });

  it('accepts WRAITH_NOTIFICATION', () => {
    expect(
      validateBroadcastChannelMessage(
        versioned({
          type: 'WRAITH_NOTIFICATION',
          channel: 'wraith-notifications',
          payload: { id: '1', title: 'pay', body: 'b', timestamp: 1 },
        }),
      ).valid,
    ).toBe(true);
  });

  it('accepts NAVIGATE_TO_MATCH', () => {
    expect(
      validateBroadcastChannelMessage(
        versioned({ type: 'NAVIGATE_TO_MATCH', stealthAddress: 'GSTEALTH' }),
      ).valid,
    ).toBe(true);
  });

  it('rejects unknown type', () => {
    expect(validateBroadcastChannelMessage(versioned({ type: 'NOT_A_TYPE' })).valid).toBe(false);
  });
});

// ─── validateWebWorkerMessage ─────────────────────────────────────────────────

describe('validateWebWorkerMessage', () => {
  it('rejects missing version', () => {
    expect(validateWebWorkerMessage({ type: 'SCAN_REQUEST' }).valid).toBe(false);
  });

  it('accepts a valid SCAN_REQUEST', () => {
    const result = validateWebWorkerMessage(
      versioned({
        type: 'SCAN_REQUEST',
        rpcUrl: 'https://soroban-testnet.stellar.org',
        announcerContract: 'CABC',
        viewingKey: new Uint8Array(32),
        spendingPubKey: new Uint8Array(32),
        spendingScalar: BigInt(42),
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects SCAN_REQUEST with missing rpcUrl', () => {
    const result = validateWebWorkerMessage(
      versioned({
        type: 'SCAN_REQUEST',
        announcerContract: 'CABC',
        viewingKey: new Uint8Array(32),
        spendingPubKey: new Uint8Array(32),
        spendingScalar: BigInt(42),
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/rpcUrl/);
  });

  it('accepts SUCCESS with results array', () => {
    expect(validateWebWorkerMessage(versioned({ type: 'SUCCESS', results: [] })).valid).toBe(true);
  });

  it('rejects SUCCESS without results array', () => {
    expect(validateWebWorkerMessage(versioned({ type: 'SUCCESS' })).valid).toBe(false);
  });

  it('accepts ERROR with error string', () => {
    expect(validateWebWorkerMessage(versioned({ type: 'ERROR', error: 'scan failed' })).valid).toBe(
      true,
    );
  });

  it('rejects ERROR without error string', () => {
    expect(validateWebWorkerMessage(versioned({ type: 'ERROR' })).valid).toBe(false);
  });

  it('rejects unknown type', () => {
    expect(validateWebWorkerMessage(versioned({ type: 'UNKNOWN' })).valid).toBe(false);
  });
});
