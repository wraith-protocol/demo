import { describe, expect, it, vi } from 'vitest';
import type { AuctionBid } from '@/lib/auctionEncryption';
import { submitBidWithRecovery, TransactionSubmissionError } from './auctionBidSubmission';

const bid: AuctionBid = {
  name: 'nova',
  amountStroops: '25000000',
  depositStroops: '25000000',
  saltHex: 'ab'.repeat(32),
  revealed: false,
};

function setup() {
  let storedBid: AuctionBid = bid;
  const saveBid = vi.fn(async (nextBid: AuctionBid) => {
    storedBid = nextBid;
  });
  const updateBidSubmission = vi.fn(
    async (
      _name: string,
      status: NonNullable<AuctionBid['submissionStatus']>,
      transactionHash?: string,
    ) => {
      storedBid = { ...storedBid, submissionStatus: status, transactionHash };
    },
  );
  return {
    saveBid,
    updateBidSubmission,
    getStoredBid: () => storedBid,
  };
}

describe('auction bid submission recovery', () => {
  it('stages the encrypted secret before signing and makes wallet rejection retryable', async () => {
    const state = setup();
    const calls: string[] = [];
    const signTransaction = vi.fn(async () => {
      calls.push('sign');
      throw new Error('User rejected request');
    });
    const saveBid = vi.fn(async (nextBid: AuctionBid) => {
      calls.push('save');
      state.saveBid(nextBid);
    });
    const submitTransaction = vi.fn();

    const result = await submitBidWithRecovery(bid, {
      ...state,
      saveBid,
      buildTransaction: vi.fn().mockResolvedValue('unsigned-xdr'),
      signTransaction,
      submitTransaction,
    });

    expect(result.status).toBe('failed');
    expect(calls).toEqual(['save', 'sign']);
    expect(saveBid).toHaveBeenCalledWith({ ...bid, submissionStatus: 'pending' });
    expect(state.getStoredBid()).toMatchObject({
      saltHex: bid.saltHex,
      submissionStatus: 'failed',
    });
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it('marks a confirmed pre-broadcast rejection failed and preserves the same secret', async () => {
    const state = setup();

    const result = await submitBidWithRecovery(bid, {
      ...state,
      buildTransaction: vi.fn().mockResolvedValue('unsigned-xdr'),
      signTransaction: vi.fn().mockResolvedValue('signed-xdr'),
      submitTransaction: vi
        .fn()
        .mockRejectedValue(new TransactionSubmissionError('Transaction rejected', 'rejected')),
    });

    expect(result.status).toBe('failed');
    expect(state.getStoredBid()).toMatchObject({
      saltHex: bid.saltHex,
      amountStroops: bid.amountStroops,
      submissionStatus: 'failed',
    });
  });

  it('keeps ambiguous post-broadcast failures non-retryable', async () => {
    const state = setup();

    const result = await submitBidWithRecovery(bid, {
      ...state,
      buildTransaction: vi.fn().mockResolvedValue('unsigned-xdr'),
      signTransaction: vi.fn().mockResolvedValue('signed-xdr'),
      submitTransaction: vi
        .fn()
        .mockRejectedValue(
          new TransactionSubmissionError('Connection timed out', 'unknown', 'possible-hash'),
        ),
    });

    expect(result.status).toBe('unknown');
    expect(result.transactionHash).toBe('possible-hash');
    expect(state.getStoredBid()).toMatchObject({
      saltHex: bid.saltHex,
      submissionStatus: 'unknown',
      transactionHash: 'possible-hash',
    });
  });

  it('persists the transaction hash before broadcast for reload-safe reconciliation', async () => {
    const state = setup();
    const calls: string[] = [];
    const submitTransaction = vi.fn(
      async (_xdr: string, onPrepared?: (hash: string) => Promise<void>) => {
        await onPrepared?.('prepared-hash');
        calls.push('broadcast');
        return 'prepared-hash';
      },
    );
    const updateBidSubmission = vi.fn(
      async (
        name: string,
        status: NonNullable<AuctionBid['submissionStatus']>,
        transactionHash?: string,
      ) => {
        calls.push(`persist:${status}:${transactionHash ?? ''}`);
        await state.updateBidSubmission(name, status, transactionHash);
      },
    );

    const result = await submitBidWithRecovery(bid, {
      ...state,
      updateBidSubmission,
      buildTransaction: vi.fn().mockResolvedValue('unsigned-xdr'),
      signTransaction: vi.fn().mockResolvedValue('signed-xdr'),
      submitTransaction,
    });

    expect(result.status).toBe('unknown');
    expect(calls).toEqual([
      'persist:pending:prepared-hash',
      'broadcast',
      'persist:unknown:prepared-hash',
    ]);
    expect(updateBidSubmission).toHaveBeenCalledWith('nova', 'unknown', 'prepared-hash');
  });

  it('does not mark a submitted transaction committed before Soroban confirms execution', async () => {
    const state = setup();

    const result = await submitBidWithRecovery(bid, {
      ...state,
      buildTransaction: vi.fn().mockResolvedValue('unsigned-xdr'),
      signTransaction: vi.fn().mockResolvedValue('signed-xdr'),
      submitTransaction: vi.fn().mockResolvedValue('transaction-hash'),
    });

    expect(result.status).toBe('unknown');
    expect(result.transactionHash).toBe('transaction-hash');
    expect(state.getStoredBid()).toMatchObject({
      saltHex: bid.saltHex,
      submissionStatus: 'unknown',
      transactionHash: 'transaction-hash',
    });
  });
});
