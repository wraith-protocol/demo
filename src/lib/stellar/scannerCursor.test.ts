import { describe, expect, it } from 'vitest';
import {
  readScanCursor,
  retentionGapFromError,
  retentionErrorFromRpcMessage,
  scanCursorKey,
  writeScanCursor,
} from './scannerCursor';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe('Stellar scanner cursor', () => {
  it('persists the next ledger per wallet', () => {
    const storage = memoryStorage();
    const wallet = 'GTEST';
    storage.clear();
    writeScanCursor(storage, wallet, 501);
    expect(storage.getItem(scanCursorKey(wallet))).toBe('501');
    expect(readScanCursor(storage, wallet)).toBe(501);
  });

  it('ignores invalid saved cursors', () => {
    const storage = memoryStorage();
    storage.setItem(scanCursorKey('GTEST'), 'not-a-ledger');
    expect(readScanCursor(storage, 'GTEST')).toBeUndefined();
  });

  it('detects the SDK Stellar retention error shape', () => {
    expect(
      retentionGapFromError({
        name: 'RetentionExceededError',
        requestedLedger: 100,
        oldestAvailableLedger: 250,
      }),
    ).toEqual({ requestedLedger: 100, oldestAvailableLedger: 250 });
  });

  it('does not classify unrelated errors as retention gaps', () => {
    expect(retentionGapFromError(new Error('network down'))).toBeUndefined();
  });

  it('maps an RPC ledger range error to the SDK retention error shape', () => {
    const error = retentionErrorFromRpcMessage(
      100,
      'startLedger must be within the ledger range: 250 - 500',
    );
    expect(error).toMatchObject({
      name: 'RetentionExceededError',
      requestedLedger: 100,
      oldestAvailableLedger: 250,
    });
    expect(retentionErrorFromRpcMessage(250, 'ledger range: 250 - 500')).toBeUndefined();
  });
});
