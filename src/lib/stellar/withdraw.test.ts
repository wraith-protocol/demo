import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  calculateBatchFee,
  estimateBatchWallClock,
  validateBatchWithdrawal,
  buildBatchWithdrawTx,
  submitBatchWithdrawal,
} from './withdraw';
import type { BatchWithdrawItem } from './withdraw';
import type { MatchedAnnouncement } from '@wraith-protocol/sdk/chains/stellar';

import { Keypair } from '@stellar/stellar-sdk';

// Cache generated keypairs per index so they are deterministic per test run
const mockKeypairs: Record<number, Keypair> = {};

function getMockKeypair(index: number): Keypair {
  if (!mockKeypairs[index]) {
    mockKeypairs[index] = Keypair.random();
  }
  return mockKeypairs[index];
}

// Mock matched announcement factory
function createMockMatch(addressIndex: number): MatchedAnnouncement {
  const kp = getMockKeypair(addressIndex);
  const scalar = BigInt(123456789 + addressIndex);
  const stealthPubKeyBytes = kp.rawPublicKey();

  return {
    schemeId: 1,
    stealthAddress: kp.publicKey(),
    caller: 'GBRPYHIL2CI3FNQ4BXLFMNDLFPPPU2HY5CHJDSHCYHGVG3WXZTFMAFZ2',
    ephemeralPubKey: '01020304',
    metadata: '00',
    stealthPrivateScalar: scalar,
    stealthPubKeyBytes,
  };
}

const VALID_DESTINATION = getMockKeypair(99).publicKey();

describe('src/lib/stellar/withdraw.ts', () => {
  describe('calculateBatchFee', () => {
    it('calculates total fee in stroops and XLM for 1 item', () => {
      const fee = calculateBatchFee(1);
      expect(fee.totalFeeStroops).toBe('100');
      expect(fee.totalFeeXLM).toBe('0.0000100');
    });

    it('calculates total fee for 20 items (bench requirement)', () => {
      const fee = calculateBatchFee(20);
      expect(fee.totalFeeStroops).toBe('2000');
      expect(fee.totalFeeXLM).toBe('0.0002000');
    });
  });

  describe('estimateBatchWallClock', () => {
    it('returns 0 for 0 items', () => {
      expect(estimateBatchWallClock(0)).toBe(0);
    });

    it('returns 5s for 1 item', () => {
      expect(estimateBatchWallClock(1)).toBe(5);
    });

    it('returns 5s for 20 items in a single ledger block', () => {
      expect(estimateBatchWallClock(20)).toBe(5);
    });

    it('scales for larger batches exceeding single block capacity', () => {
      expect(estimateBatchWallClock(21)).toBe(10);
      expect(estimateBatchWallClock(40)).toBe(10);
    });
  });

  describe('validateBatchWithdrawal', () => {
    it('validates items with global destination address', () => {
      const items: BatchWithdrawItem[] = [
        {
          match: createMockMatch(1),
          balance: '10.0',
          assetKey: 'XLM',
        },
        {
          match: createMockMatch(2),
          balance: '50.0',
          assetKey: 'XLM',
        },
      ];

      const preview = validateBatchWithdrawal(items, VALID_DESTINATION);
      expect(preview.validItems).toHaveLength(2);
      expect(preview.invalidItems).toHaveLength(0);
      expect(preview.totalFeeStroops).toBe('200');
      expect(preview.expectedWallClockSeconds).toBe(5);
      expect(preview.isAtomic).toBe(true);
    });

    it('flags items with missing or invalid destination', () => {
      const items: BatchWithdrawItem[] = [
        {
          match: createMockMatch(1),
          balance: '10.0',
          assetKey: 'XLM',
          destination: 'invalid_address',
        },
        {
          match: createMockMatch(2),
          balance: '10.0',
          assetKey: 'XLM',
          destination: '',
        },
      ];

      const preview = validateBatchWithdrawal(items);
      expect(preview.validItems).toHaveLength(0);
      expect(preview.invalidItems).toHaveLength(2);
      expect(preview.invalidItems[0].reason).toContain('Invalid Stellar G... address format');
      expect(preview.invalidItems[1].reason).toContain('Missing destination address');
    });

    it('flags items with zero or negative balance', () => {
      const items: BatchWithdrawItem[] = [
        {
          match: createMockMatch(1),
          balance: '0',
          assetKey: 'XLM',
        },
      ];

      const preview = validateBatchWithdrawal(items, VALID_DESTINATION);
      expect(preview.validItems).toHaveLength(0);
      expect(preview.invalidItems).toHaveLength(1);
      expect(preview.invalidItems[0].reason).toBe('Zero or negative balance');
    });

    it('flags XLM items with balance too low for reserve', () => {
      const items: BatchWithdrawItem[] = [
        {
          match: createMockMatch(1),
          balance: '0.5', // Below 1.0 XLM reserve
          assetKey: 'XLM',
        },
      ];

      const preview = validateBatchWithdrawal(items, VALID_DESTINATION);
      expect(preview.validItems).toHaveLength(0);
      expect(preview.invalidItems).toHaveLength(1);
      expect(preview.invalidItems[0].reason).toContain('reserve');
    });

    it('handles 20-item benchmarking batch validation cleanly', () => {
      const items: BatchWithdrawItem[] = Array.from({ length: 20 }, (_, i) => ({
        match: createMockMatch(i + 1),
        balance: '10.0',
        assetKey: 'XLM',
      }));

      const preview = validateBatchWithdrawal(items, VALID_DESTINATION);
      expect(preview.validItems).toHaveLength(20);
      expect(preview.invalidItems).toHaveLength(0);
      expect(preview.totalFeeStroops).toBe('2000');
    });
  });
});

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

describe('submitBatchWithdrawal', () => {
  it('returns success and txHash on Horizon HTTP 200 response', async () => {
    server.use(
      http.post('https://horizon-testnet.stellar.org/transactions', () =>
        HttpResponse.json({ hash: '0x123abc' }),
      ),
    );

    const items = validateBatchWithdrawal(
      [
        {
          match: createMockMatch(1),
          balance: '10.0',
          assetKey: 'XLM',
        },
      ],
      VALID_DESTINATION,
    ).validItems;

    const result = await submitBatchWithdrawal('mock_xdr', items);
    expect(result.success).toBe(true);
    expect(result.txHash).toBe('0x123abc');
    expect(result.entryResults[0].success).toBe(true);
  });

  it('surfaces per-entry cause when transaction fails on Horizon', async () => {
    server.use(
      http.post('https://horizon-testnet.stellar.org/transactions', () =>
        HttpResponse.json(
          {
            title: 'Transaction Failed',
            extras: {
              result_codes: {
                transaction: 'tx_failed',
                operations: ['op_no_destination', 'op_underfunded'],
              },
            },
          },
          { status: 400 },
        ),
      ),
    );

    const items = validateBatchWithdrawal(
      [
        {
          match: createMockMatch(1),
          balance: '10.0',
          assetKey: 'XLM',
        },
        {
          match: createMockMatch(2),
          balance: '10.0',
          assetKey: 'XLM',
        },
      ],
      VALID_DESTINATION,
    ).validItems;

    const result = await submitBatchWithdrawal('mock_xdr', items);
    expect(result.success).toBe(false);
    expect(result.error).toBe('tx_failed');
    expect(result.entryResults[0].error).toBe('Operation failed: op_no_destination');
    expect(result.entryResults[1].error).toBe('Operation failed: op_underfunded');
  });
});
