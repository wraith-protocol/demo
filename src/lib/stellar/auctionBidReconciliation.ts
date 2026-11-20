import type { AuctionBid } from '@/lib/auctionEncryption';

export type AuthoritativeTransactionStatus = 'SUCCESS' | 'FAILED' | 'NOT_FOUND';

export type TransactionStatusLookup = (hash: string) => Promise<AuthoritativeTransactionStatus>;

export type BidSubmissionUpdater = (
  name: string,
  status: NonNullable<AuctionBid['submissionStatus']>,
  transactionHash?: string,
) => Promise<void>;

/**
 * Resolve saved ambiguous submissions only from an authoritative Soroban
 * transaction result. NOT_FOUND is deliberately inconclusive: RPC indexing,
 * retention, or propagation delays must never make a retry appear safe.
 */
export async function reconcileUnknownBid(
  bid: AuctionBid,
  lookup: TransactionStatusLookup,
  update: BidSubmissionUpdater,
): Promise<'committed' | 'failed' | 'unknown' | 'skipped'> {
  if (
    (bid.submissionStatus !== 'unknown' && bid.submissionStatus !== 'pending') ||
    !bid.transactionHash
  ) {
    return 'skipped';
  }

  let status: AuthoritativeTransactionStatus;
  try {
    status = await lookup(bid.transactionHash);
  } catch {
    return 'unknown';
  }

  if (status === 'SUCCESS') {
    await update(bid.name, 'committed', bid.transactionHash);
    return 'committed';
  }

  if (status === 'FAILED') {
    await update(bid.name, 'failed');
    return 'failed';
  }

  return 'unknown';
}

export async function reconcileUnknownBids(
  bids: Record<string, AuctionBid>,
  lookup: TransactionStatusLookup,
  update: BidSubmissionUpdater,
): Promise<void> {
  for (const bid of Object.values(bids)) {
    await reconcileUnknownBid(bid, lookup, update);
  }
}
