import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { decodeStealthMetaAddress } from '@wraith-protocol/sdk/chains/stellar';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { useStealthKeys } from '@/context/StealthKeysContext';
import { useContacts } from '@/store/contactsStore';
import { useNameHistory } from '@/store/nameHistoryStore';
import { useNameWatchlistStore } from '@/store/nameWatchlistStore';
import { stellarTxUrl } from '@/lib/explorer';
import {
  MIN_AUCTION_BID_INCREMENT,
  NAMES_CONTRACT_ID,
  buildClaimAuctionNameTransaction,
  buildCommitNameBidTransaction,
  buildRefundNameBidTransaction,
  buildRevealNameBidTransaction,
  buildSettleNameAuctionTransaction,
  computeNameBidCommitment,
  getActiveNameAuctions,
  getNameAuction,
  getNameAuctionConfig,
  submitTransaction,
  type NameAuction,
  type NameAuctionConfig,
} from '@/lib/stellar/names';

const STROOPS_PER_XLM = 10_000_000n;

function parseXlm(value: string): bigint | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(fraction.padEnd(7, '0'));
}

function formatXlm(stroops: bigint) {
  const whole = stroops / STROOPS_PER_XLM;
  const fraction = (stroops % STROOPS_PER_XLM).toString().padStart(7, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction} XLM` : `${whole} XLM`;
}

function formatEndsAt(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp * 1000));
}

function phaseFor(auction: NameAuction, now: number) {
  if (auction.settled) return 'settled';
  if (now < auction.commitEnd) return 'commit';
  if (now < auction.revealEnd) return 'reveal';
  return 'ended';
}

export default function NamesAuctions() {
  const { address, isConnected, signTransaction } = useStellarWallet();
  const { stellarMetaAddress } = useStealthKeys();
  const { isKnownAddress } = useContacts();
  const { isKnownRecipient } = useNameHistory();
  const watchedAuctions = useNameWatchlistStore((state) => state.watchedAuctions);
  const bids = useNameWatchlistStore((state) => state.bids);
  const watchAuction = useNameWatchlistStore((state) => state.watchAuction);
  const unwatchAuction = useNameWatchlistStore((state) => state.unwatchAuction);
  const saveBid = useNameWatchlistStore((state) => state.saveBid);
  const markBidRevealed = useNameWatchlistStore((state) => state.markBidRevealed);
  const removeBid = useNameWatchlistStore((state) => state.removeBid);

  const [auctions, setAuctions] = useState<NameAuction[]>([]);
  const [config, setConfig] = useState<NameAuctionConfig | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState('');
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState('');
  const [lookupName, setLookupName] = useState('');
  const [selectedAuction, setSelectedAuction] = useState<NameAuction | null>(null);
  const [bidAmount, setBidAmount] = useState('');

  const trackedNames = useMemo(
    () => [...new Set([...watchedAuctions.map((item) => item.name), ...Object.keys(bids)])],
    [bids, watchedAuctions],
  );
  const trackedNamesKey = trackedNames.join('|');
  const isUnknownContract =
    !isKnownAddress(NAMES_CONTRACT_ID) && !isKnownRecipient(NAMES_CONTRACT_ID);

  const refreshAuctions = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const [nextAuctions, nextConfig] = await Promise.all([
        getActiveNameAuctions(trackedNames),
        getNameAuctionConfig(),
      ]);
      setAuctions(nextAuctions.sort((a, b) => a.revealEnd - b.revealEnd));
      setConfig(nextConfig);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load auctions');
    } finally {
      setIsLoading(false);
    }
  }, [trackedNamesKey]);

  useEffect(() => {
    void refreshAuctions();
  }, [refreshAuctions]);

  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => globalThis.clearInterval(timer);
  }, []);

  const trackAuction = async () => {
    const name = lookupName
      .trim()
      .toLowerCase()
      .replace(/\.wraith$/, '');
    if (!name) return;
    setPendingAction(`track:${name}`);
    setError('');
    try {
      const auction = await getNameAuction(name);
      if (!auction) throw new Error(`No auction exists for ${name}.wraith`);
      watchAuction({ name: auction.name, endsAt: auction.revealEnd });
      setLookupName('');
    } catch (trackError) {
      setError(trackError instanceof Error ? trackError.message : 'Failed to find auction');
    } finally {
      setPendingAction('');
    }
  };

  const submitAuctionTransaction = async (action: string, buildXdr: () => Promise<string>) => {
    setPendingAction(action);
    setError('');
    setTxHash('');
    try {
      const xdr = await buildXdr();
      const signedXdr = await signTransaction(xdr);
      const hash = await submitTransaction(signedXdr);
      setTxHash(hash);
      await refreshAuctions();
      return true;
    } catch (transactionError) {
      setError(transactionError instanceof Error ? transactionError.message : 'Transaction failed');
      return false;
    } finally {
      setPendingAction('');
    }
  };

  const minimumBid = selectedAuction
    ? [
        config?.reservePrice ?? 0n,
        selectedAuction.highestAmount > 0n
          ? selectedAuction.highestAmount + (config?.minBidIncrement ?? MIN_AUCTION_BID_INCREMENT)
          : 0n,
      ].reduce((highest, value) => (value > highest ? value : highest), 0n)
    : 0n;
  const parsedBid = parseXlm(bidAmount);
  const bidError =
    bidAmount && parsedBid === null
      ? 'Enter an XLM amount with no more than 7 decimal places.'
      : parsedBid !== null && parsedBid < minimumBid
        ? `Minimum bid is ${formatXlm(minimumBid)}.`
        : '';

  const placeBid = async () => {
    if (!address || !selectedAuction || parsedBid === null || bidError) return;
    const action = `bid:${selectedAuction.name}`;
    setPendingAction(action);
    setError('');
    try {
      const salt = globalThis.crypto.getRandomValues(new Uint8Array(32));
      const saltHex = Array.from(salt, (byte) => byte.toString(16).padStart(2, '0')).join('');
      const commitmentHex = await computeNameBidCommitment(
        address,
        selectedAuction.name,
        parsedBid,
        saltHex,
      );
      const submitted = await submitAuctionTransaction(action, () =>
        buildCommitNameBidTransaction(address, {
          name: selectedAuction.name,
          commitmentHex,
          deposit: parsedBid,
        }),
      );
      if (submitted) {
        saveBid({
          name: selectedAuction.name,
          amountStroops: parsedBid.toString(),
          depositStroops: parsedBid.toString(),
          saltHex,
          revealed: false,
        });
        watchAuction({ name: selectedAuction.name, endsAt: selectedAuction.revealEnd });
        setSelectedAuction(null);
        setBidAmount('');
      }
    } catch (commitmentError) {
      setError(
        commitmentError instanceof Error ? commitmentError.message : 'Failed to prepare bid',
      );
    } finally {
      setPendingAction('');
    }
  };

  const revealBid = async (auction: NameAuction) => {
    if (!address) return;
    const bid = bids[auction.name];
    if (!bid) return;
    const submitted = await submitAuctionTransaction(`reveal:${auction.name}`, () =>
      buildRevealNameBidTransaction(address, {
        name: auction.name,
        amount: BigInt(bid.amountStroops),
        saltHex: bid.saltHex,
      }),
    );
    if (submitted) markBidRevealed(auction.name);
  };

  const settleAuction = async (auction: NameAuction) => {
    if (!address) return;
    await submitAuctionTransaction(`settle:${auction.name}`, () =>
      buildSettleNameAuctionTransaction(address, auction.name),
    );
  };

  const claimName = async (auction: NameAuction) => {
    if (!address || !stellarMetaAddress) {
      setError('Derive your Stellar stealth keys before claiming this name.');
      return;
    }
    const decoded = decodeStealthMetaAddress(stellarMetaAddress);
    const metaAddress = new Uint8Array(64);
    metaAddress.set(decoded.spendingPubKey, 0);
    metaAddress.set(decoded.viewingPubKey, 32);
    const submitted = await submitAuctionTransaction(`claim:${auction.name}`, () =>
      buildClaimAuctionNameTransaction(address, auction.name, metaAddress),
    );
    if (submitted) removeBid(auction.name);
  };

  const refundBid = async (auction: NameAuction) => {
    if (!address) return;
    const submitted = await submitAuctionTransaction(`refund:${auction.name}`, () =>
      buildRefundNameBidTransaction(address, auction.name),
    );
    if (submitted) removeBid(auction.name);
  };

  if (!isConnected) {
    return (
      <section className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Stellar / Names / Auctions
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Name Auctions
        </h1>
        <p className="font-body text-sm text-on-surface-variant">
          Connect your Stellar wallet to bid on premium Wraith Names.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Link
          to="/names"
          className="font-mono text-[10px] uppercase tracking-widest text-outline hover:text-primary"
        >
          Stellar / Names / Auctions
        </Link>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Name Auctions
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Bid privately during the commit phase, reveal your bid, then claim the name or refund your
          deposit after the auction.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          value={lookupName}
          onChange={(event) =>
            setLookupName(event.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ''))
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter') void trackAuction();
          }}
          placeholder="Find a premium name auction"
          className="h-11 flex-1 border border-outline-variant bg-surface px-3 font-mono text-sm text-primary placeholder:text-outline"
        />
        <button
          type="button"
          onClick={trackAuction}
          disabled={!lookupName || pendingAction.startsWith('track:')}
          className="h-11 border border-primary px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-primary disabled:opacity-30"
        >
          Track
        </button>
      </div>

      {error && (
        <p role="alert" className="font-body text-sm text-error">
          {error}
        </p>
      )}
      {txHash && (
        <p className="font-body text-sm text-tertiary">
          Transaction submitted.{' '}
          <a
            href={stellarTxUrl(txHash)}
            target="_blank"
            rel="noreferrer"
            className="font-mono underline"
          >
            View transaction
          </a>
        </p>
      )}

      <div className="flex flex-col gap-3">
        {isLoading ? (
          <p className="font-mono text-xs text-outline">Loading auctions...</p>
        ) : auctions.length === 0 ? (
          <div className="border border-outline-variant bg-surface-container p-6 text-center">
            <p className="font-body text-sm text-on-surface-variant">
              Track a premium name to see its active auction.
            </p>
          </div>
        ) : (
          auctions.map((auction) => {
            const phase = phaseFor(auction, now);
            const bid = bids[auction.name];
            const isWinner = auction.highestBidder === address;
            const isWatched = watchedAuctions.some((item) => item.name === auction.name);
            return (
              <article
                key={auction.name}
                className="border border-outline-variant bg-surface-container p-4 sm:p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-heading text-lg font-semibold text-on-surface">
                      {auction.name}.wraith
                    </h2>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-tertiary">
                      {phase}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      isWatched
                        ? unwatchAuction(auction.name)
                        : watchAuction({ name: auction.name, endsAt: auction.revealEnd })
                    }
                    className="font-heading text-[10px] uppercase tracking-widest text-primary"
                    aria-pressed={isWatched}
                  >
                    {isWatched ? 'Watching' : 'Watch'}
                  </button>
                </div>

                <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-outline-variant/40 pt-4 sm:grid-cols-3">
                  <div>
                    <dt className="font-mono text-[9px] uppercase tracking-widest text-outline">
                      Top bid
                    </dt>
                    <dd className="mt-1 font-mono text-xs text-on-surface">
                      {auction.highestAmount ? formatXlm(auction.highestAmount) : 'Not revealed'}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[9px] uppercase tracking-widest text-outline">
                      Ends at
                    </dt>
                    <dd className="mt-1 font-mono text-xs text-on-surface">
                      {formatEndsAt(auction.revealEnd)}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[9px] uppercase tracking-widest text-outline">
                      Your bid
                    </dt>
                    <dd className="mt-1 font-mono text-xs text-on-surface">
                      {bid ? formatXlm(BigInt(bid.amountStroops)) : '—'}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 flex flex-wrap gap-2">
                  {phase === 'commit' && !bid && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAuction(auction);
                        setBidAmount('');
                      }}
                      className="h-9 bg-primary px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-surface"
                    >
                      Place bid
                    </button>
                  )}
                  {phase === 'commit' && bid && (
                    <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                      Bid committed — return to reveal it
                    </span>
                  )}
                  {phase === 'reveal' && bid && !bid.revealed && (
                    <button
                      type="button"
                      onClick={() => void revealBid(auction)}
                      disabled={pendingAction === `reveal:${auction.name}`}
                      className="h-9 bg-primary px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-surface disabled:opacity-40"
                    >
                      {pendingAction === `reveal:${auction.name}` ? 'Revealing...' : 'Reveal bid'}
                    </button>
                  )}
                  {phase === 'ended' && (
                    <button
                      type="button"
                      onClick={() => void settleAuction(auction)}
                      disabled={pendingAction === `settle:${auction.name}`}
                      className="h-9 border border-primary px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-primary disabled:opacity-40"
                    >
                      {pendingAction === `settle:${auction.name}`
                        ? 'Settling...'
                        : 'Settle auction'}
                    </button>
                  )}
                  {phase === 'settled' && isWinner && (
                    <button
                      type="button"
                      onClick={() => void claimName(auction)}
                      disabled={pendingAction === `claim:${auction.name}`}
                      className="h-9 bg-primary px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-surface disabled:opacity-40"
                    >
                      {pendingAction === `claim:${auction.name}` ? 'Claiming...' : 'Claim name'}
                    </button>
                  )}
                  {(phase === 'ended' || phase === 'settled') && bid && !isWinner && (
                    <button
                      type="button"
                      onClick={() => void refundBid(auction)}
                      disabled={pendingAction === `refund:${auction.name}`}
                      className="h-9 border border-primary px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-primary disabled:opacity-40"
                    >
                      {pendingAction === `refund:${auction.name}` ? 'Refunding...' : 'Refund bid'}
                    </button>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>

      {selectedAuction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="place-bid-title"
        >
          <div className="w-full max-w-md border border-outline-variant bg-surface p-5 sm:p-6">
            <div className="flex items-start justify-between">
              <div>
                <h2
                  id="place-bid-title"
                  className="font-heading text-lg font-semibold uppercase tracking-wider text-on-surface"
                >
                  Place bid
                </h2>
                <p className="mt-1 font-mono text-xs text-outline">{selectedAuction.name}.wraith</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAuction(null)}
                className="text-xl text-outline hover:text-primary"
                aria-label="Close bid modal"
              >
                ×
              </button>
            </div>

            <label className="mt-5 block font-mono text-[10px] uppercase tracking-widest text-outline">
              Bid amount (XLM)
            </label>
            <input
              autoFocus
              inputMode="decimal"
              value={bidAmount}
              onChange={(event) => setBidAmount(event.target.value)}
              placeholder="0.0"
              aria-invalid={Boolean(bidError)}
              className="mt-2 h-12 w-full border border-outline-variant bg-surface-container px-4 font-heading text-xl text-primary"
            />
            <p className={`mt-2 font-mono text-[10px] ${bidError ? 'text-error' : 'text-outline'}`}>
              {bidError || `Minimum bid: ${formatXlm(minimumBid)}`}
            </p>

            {isUnknownContract && (
              <div className="mt-4 flex items-start gap-2 border border-outline-variant/50 bg-surface-container p-4">
                <span aria-hidden="true">⚠️</span>
                <div>
                  <p className="text-sm font-medium text-on-surface">
                    You haven't paid this recipient before
                  </p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    This bid sends funds to the Wraith Names contract. Verify the contract and
                    network before approving the transaction.
                  </p>
                </div>
              </div>
            )}

            <p className="mt-4 font-body text-xs leading-relaxed text-outline">
              Your amount and recovery secret stay in this browser until reveal. Clearing site data
              before revealing can make the bid unrecoverable.
            </p>

            {error && (
              <p role="alert" className="mt-4 font-body text-sm text-error">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={() => void placeBid()}
              disabled={
                parsedBid === null ||
                Boolean(bidError) ||
                pendingAction === `bid:${selectedAuction.name}`
              }
              className="mt-5 h-11 w-full bg-primary font-heading text-[11px] font-semibold uppercase tracking-widest text-surface disabled:opacity-30"
            >
              {pendingAction === `bid:${selectedAuction.name}`
                ? 'Confirm in wallet...'
                : 'Place bid'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
