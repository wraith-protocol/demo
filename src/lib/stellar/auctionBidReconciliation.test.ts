import { describe, expect, it, vi } from 'vitest';
import type { AuctionBid } from '@/lib/auctionEncryption';
import {
  reconcileUnknownBid,
  reconcileUnknownBids,
  type TransactionStatusLookup,
} from './auctionBidReconciliation';

const bid: AuctionBid = {
  name: 'nova',
  amountStroops: '25000000',
  depositStroops: '25000000',
  saltHex: 'ab'.repeat(32),
  revealed: false,
  submissionStatus: 'unknown',
  transactionHash: 'tx-hash',
};

describe('auction bid transaction reconciliation', () => {
  it('promotes an unknown bid to committed after an authoritative success', async () => {
    const lookup = vi.fn<TransactionStatusLookup>().mockResolvedValue('SUCCESS');
    const update = vi.fn().mockResolvedValue(undefined);

    await expect(reconcileUnknownBid(bid, lookup, update)).resolves.toBe('committed');
    expect(lookup).toHaveBeenCalledWith('tx-hash');
    expect(update).toHaveBeenCalledWith('nova', 'committed', 'tx-hash');
  });

  it('moves an unknown bid to failed only after an authoritative failure', async () => {
    const lookup = vi.fn<TransactionStatusLookup>().mockResolvedValue('FAILED');
    const update = vi.fn().mockResolvedValue(undefined);

    await expect(reconcileUnknownBid(bid, lookup, update)).resolves.toBe('failed');
    expect(update).toHaveBeenCalledWith('nova', 'failed');
  });

  it('preserves unknown when RPC cannot find the transaction yet', async () => {
    const lookup = vi.fn<TransactionStatusLookup>().mockResolvedValue('NOT_FOUND');
    const update = vi.fn().mockResolvedValue(undefined);

    await expect(reconcileUnknownBid(bid, lookup, update)).resolves.toBe('unknown');
    expect(update).not.toHaveBeenCalled();
  });

  it('preserves unknown when the network lookup fails', async () => {
    const lookup = vi.fn<TransactionStatusLookup>().mockRejectedValue(new Error('offline'));
    const update = vi.fn().mockResolvedValue(undefined);

    await expect(reconcileUnknownBid(bid, lookup, update)).resolves.toBe('unknown');
    expect(update).not.toHaveBeenCalled();
  });

  it('resumes after reload from the persisted hash and reconciles eligible records', async () => {
    const rehydrated = JSON.parse(JSON.stringify({ nova: bid })) as Record<string, AuctionBid>;
    const lookup = vi.fn<TransactionStatusLookup>().mockResolvedValue('SUCCESS');
    const update = vi.fn().mockResolvedValue(undefined);

    await reconcileUnknownBids(rehydrated, lookup, update);

    expect(lookup).toHaveBeenCalledWith('tx-hash');
    expect(update).toHaveBeenCalledWith('nova', 'committed', 'tx-hash');
  });

  it('does not reconcile committed, failed, or hashless pending records', async () => {
    const lookup = vi.fn<TransactionStatusLookup>().mockResolvedValue('SUCCESS');
    const update = vi.fn().mockResolvedValue(undefined);
    await reconcileUnknownBids(
      {
        committed: { ...bid, name: 'committed', submissionStatus: 'committed' },
        failed: { ...bid, name: 'failed', submissionStatus: 'failed' },
        pending: {
          ...bid,
          name: 'pending',
          submissionStatus: 'pending',
          transactionHash: undefined,
        },
      },
      lookup,
      update,
    );

    expect(lookup).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
