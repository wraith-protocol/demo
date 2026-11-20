import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { decodeStealthMetaAddress } from '@wraith-protocol/sdk/chains/stellar';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { useStealthKeys } from '@/context/StealthKeysContext';
import { useContacts } from '@/store/contactsStore';
import { useNameHistory } from '@/store/nameHistoryStore';
import { useNameWatchlistStore, type AuctionBid } from '@/store/nameWatchlistStore';
import { stellarTxUrl } from '@/lib/explorer';
import { submitBidWithRecovery } from '@/lib/stellar/auctionBidSubmission';
import { reconcileUnknownBids } from '@/lib/stellar/auctionBidReconciliation';
import { tryGetStellarContractId } from '@/lib/stellar/deployments';
import {
  MIN_AUCTION_BID_INCREMENT,
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
  getNameBidTransactionStatus,
  type NameAuction,
  type NameAuctionConfig,
} from '@/lib/stellar/names';

const NAMES_CONTRACT_ID = tryGetStellarContractId('names');

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

function formatXlmInput(stroops: string) {
  const amount = BigInt(stroops);
  const whole = amount / STROOPS_PER_XLM;
  const fraction = (amount % STROOPS_PER_XLM).toString().padStart(7, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
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
  const updateBidSubmission = useNameWatchlistStore((state) => state.updateBidSubmission);
  const markBidRevealed = useNameWatchlistStore((state) => state.markBidRevealed);
  const removeBid = useNameWatchlistStore((state) => state.removeBid);

  const status = useNameWatchlistStore((state) => state.status);
  const hasLegacyPlaintext = useNameWatchlistStore((state) => state.hasLegacyPlaintext);
  const hasEncryptedVault = useNameWatchlistStore((state) => state.hasEncryptedVault);
  const inspectStorage = useNameWatchlistStore((state) => state.inspectStorage);
  const setPassphrase = useNameWatchlistStore((state) => state.setPassphrase);
  const unlock = useNameWatchlistStore((state) => state.unlock);
  const lock = useNameWatchlistStore((state) => state.lock);
  const exportBackup = useNameWatchlistStore((state) => state.exportBackup);
  const importBackup = useNameWatchlistStore((state) => state.importBackup);
  const clearLegacy = useNameWatchlistStore((state) => state.clearLegacy);

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

  // Vault UI state
  const [vaultError, setVaultError] = useState('');
  const [passphrase, setPassphraseValue] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [revealPending, setRevealPending] = useState<NameAuction | null>(null);
  const [backupReady, setBackupReady] = useState<string | null>(null);
  const importFileInput = useRef<HTMLInputElement>(null);

  const trackedNames = useMemo(
    () => [...new Set([...watchedAuctions.map((item) => item.name), ...Object.keys(bids)])],
    [bids, watchedAuctions],
  );
  const trackedNamesKey = trackedNames.join('|');
  const isUnknownContract =
    !isKnownAddress(NAMES_CONTRACT_ID) && !isKnownRecipient(NAMES_CONTRACT_ID);
  const unlocked = status === 'unlocked';

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
    inspectStorage();
  }, [inspectStorage]);

  useEffect(() => {
    void refreshAuctions();
  }, [refreshAuctions]);

  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => globalThis.clearInterval(timer);
  }, []);

  // Reconcile ambiguous submissions after unlock/reload and retry periodically.
  // Only authoritative Soroban SUCCESS/FAILED results change persisted state.
  useEffect(() => {
    if (!unlocked) return;
    let active = true;
    const reconcile = async () => {
      try {
        await reconcileUnknownBids(
          bids,
          getNameBidTransactionStatus,
          async (name, nextStatus, hash) => {
            if (active) await updateBidSubmission(name, nextStatus, hash);
          },
        );
      } catch {
        // Keep unknown/pending state on RPC or persistence errors; the next
        // interval retries without enabling reveal, refund, or another bid.
      }
    };
    void reconcile();
    const timer = globalThis.setInterval(() => void reconcile(), 15_000);
    return () => {
      active = false;
      globalThis.clearInterval(timer);
    };
  }, [bids, unlocked, updateBidSubmission]);

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
  const selectedBid = selectedAuction ? bids[selectedAuction.name] : undefined;
  const retryingBid = selectedBid?.submissionStatus === 'failed';
  const selectedBidCannotRetry =
    selectedBid?.submissionStatus === 'pending' || selectedBid?.submissionStatus === 'unknown';

  const placeBid = async () => {
    if (!unlocked) {
      setError('Set a passphrase to secure your bid recovery material before placing a bid.');
      return;
    }
    if (!address || !selectedAuction || parsedBid === null || bidError) return;
    const action = `bid:${selectedAuction.name}`;
    setPendingAction(action);
    setError('');
    setTxHash('');
    try {
      const existingBid = bids[selectedAuction.name];
      if (existingBid && existingBid.submissionStatus !== 'failed') {
        throw new Error('This bid cannot be retried until its submission status is confirmed.');
      }
      if (
        existingBid &&
        existingBid.submissionStatus === 'failed' &&
        parsedBid.toString() !== existingBid.amountStroops
      ) {
        throw new Error('A retry must use the original bid amount and recovery secret.');
      }
      const saltHex =
        existingBid?.submissionStatus === 'failed'
          ? existingBid.saltHex
          : Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), (byte) =>
              byte.toString(16).padStart(2, '0'),
            ).join('');
      const bid: AuctionBid =
        existingBid?.submissionStatus === 'failed'
          ? existingBid
          : {
              name: selectedAuction.name,
              amountStroops: parsedBid.toString(),
              depositStroops: parsedBid.toString(),
              saltHex,
              revealed: false,
            };
      const commitmentHex = await computeNameBidCommitment(
        address,
        selectedAuction.name,
        BigInt(bid.amountStroops),
        saltHex,
      );
      const result = await submitBidWithRecovery(bid, {
        saveBid,
        updateBidSubmission,
        buildTransaction: () =>
          buildCommitNameBidTransaction(address, {
            name: selectedAuction.name,
            commitmentHex,
            deposit: BigInt(bid.depositStroops),
          }),
        signTransaction,
        submitTransaction,
      });
      if (result.status === 'committed') {
        setTxHash(result.transactionHash);
        watchAuction({ name: selectedAuction.name, endsAt: selectedAuction.revealEnd });
        setSelectedAuction(null);
        setBidAmount('');
        await refreshAuctions();
      } else if (result.status === 'failed') {
        const message = result.error instanceof Error ? result.error.message : 'Transaction failed';
        setError(
          `Bid was not submitted: ${message} Your encrypted secret is saved; retry is safe.`,
        );
      } else {
        const message =
          result.error instanceof Error
            ? result.error.message
            : 'The submission outcome is unknown.';
        setError(
          `${message} Your encrypted secret is preserved. Do not retry until you confirm the transaction was not submitted.`,
        );
      }
    } catch (commitmentError) {
      setError(
        commitmentError instanceof Error
          ? commitmentError.message
          : 'Failed to prepare or persist bid recovery material.',
      );
    } finally {
      setPendingAction('');
    }
  };

  const revealBid = async (auction: NameAuction) => {
    if (!unlocked) {
      setRevealPending(auction);
      setError('Unlock your vault with your passphrase before revealing a bid.');
      return;
    }
    if (!address) return;
    const bid = bids[auction.name];
    if (!bid) return;
    setRevealPending(auction);
    const submitted = await submitAuctionTransaction(`reveal:${auction.name}`, () =>
      buildRevealNameBidTransaction(address, {
        name: auction.name,
        amount: BigInt(bid.amountStroops),
        saltHex: bid.saltHex,
      }),
    );
    setRevealPending(null);
    if (submitted) {
      try {
        await markBidRevealed(auction.name);
      } catch {
        // reveal transaction submitted; marking revealed is best-effort local state
      }
    }
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
    if (submitted) {
      try {
        await removeBid(auction.name);
      } catch {
        // claim submitted; local bid removal is best-effort
      }
    }
  };

  const refundBid = async (auction: NameAuction) => {
    if (!address) return;
    const submitted = await submitAuctionTransaction(`refund:${auction.name}`, () =>
      buildRefundNameBidTransaction(address, auction.name),
    );
    if (submitted) {
      try {
        await removeBid(auction.name);
      } catch {
        // refund submitted; local bid removal is best-effort
      }
    }
  };

  // Vault actions
  const handleSetPassphrase = async () => {
    setVaultError('');
    try {
      if (passphrase !== confirmPassphrase) {
        throw new Error('Passphrases do not match.');
      }
      if (status === 'legacy') {
        await setPassphrase(passphrase); // migrates legacy plaintext
      } else {
        await setPassphrase(passphrase); // creates new vault
      }
      setPassphraseValue('');
      setConfirmPassphrase('');
    } catch (err) {
      setVaultError(err instanceof Error ? err.message : 'Failed to set up encryption.');
    }
  };

  const handleUnlock = async () => {
    setVaultError('');
    try {
      await unlock(passphrase);
      setPassphraseValue('');
    } catch (err) {
      setVaultError(err instanceof Error ? err.message : 'Unable to unlock vault.');
    }
  };

  const handleBackup = async () => {
    setVaultError('');
    setBackupReady(null);
    try {
      const json = await exportBackup();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wraith-name-auction-backup-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setBackupReady(json);
    } catch (err) {
      setVaultError(err instanceof Error ? err.message : 'Backup failed.');
    }
  };

  const handleImportFile = async (file: File) => {
    setVaultError('');
    setImporting(true);
    try {
      const text = await file.text();
      // Never silently replace a non-empty current vault. Require explicit
      // confirmation before importing overwrites the current recovery secrets.
      let replace = false;
      if (hasEncryptedVault) {
        const confirmed = window.confirm(
          'Your current vault already contains bid recovery secrets. Importing this backup will replace it. Export your current vault first, or click OK to confirm replacement.',
        );
        if (!confirmed) {
          setImporting(false);
          return;
        }
        replace = true;
      }
      await importBackup(text, passphrase, { replace });
      setPassphraseValue('');
      setImportFile(null);
    } catch (err) {
      setVaultError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const handleClearLegacy = async () => {
    setVaultError('');
    if (!hasLegacyPlaintext) return;
    if (
      !confirm(
        'This will permanently delete the unencrypted legacy bid recovery material from localStorage. The encrypted vault must already exist. Continue?',
      )
    ) {
      return;
    }
    try {
      const cleared = await clearLegacy();
      if (!cleared) {
        setVaultError('No legacy plaintext found to clear.');
      }
    } catch (err) {
      setVaultError(err instanceof Error ? err.message : 'Failed to clear legacy plaintext.');
    }
  };

  const bidCount = Object.keys(bids).length;
  const statusLabel =
    status === 'empty'
      ? 'No vault'
      : status === 'legacy'
        ? 'Legacy plaintext (unmigrated)'
        : status === 'locked'
          ? 'Vault locked'
          : status === 'unlocked'
            ? 'Vault unlocked'
            : 'Error';

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
          deposit after the auction. Bid recovery material (salt, amount, deposit) is encrypted with
          your passphrase and never written to localStorage in plaintext.
        </p>
      </div>

      {/* Recovery vault controls */}
      <div className="border border-outline-variant bg-surface-container p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <span className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface">
              Recovery vault
            </span>
            <span
              className={`font-mono text-[10px] uppercase tracking-widest ml-2 ${
                status === 'unlocked'
                  ? 'text-tertiary'
                  : status === 'legacy'
                    ? 'text-error'
                    : 'text-outline'
              }`}
            >
              [{statusLabel}]
            </span>
          </div>
          {status === 'unlocked' && (
            <button
              type="button"
              onClick={lock}
              className="h-9 border border-outline-variant px-3 font-heading text-[10px] font-semibold uppercase tracking-widest text-outline transition-colors hover:bg-surface-bright"
            >
              Lock
            </button>
          )}
        </div>

        {vaultError && (
          <p role="alert" className="mt-2 font-mono text-xs text-error">
            {vaultError}
          </p>
        )}

        {status === 'empty' || status === 'legacy' || status === 'locked' ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="block font-mono text-[10px] uppercase tracking-widest text-outline mb-1">
                {status === 'empty'
                  ? 'Set passphrase'
                  : status === 'locked'
                    ? 'Unlock passphrase'
                    : 'Migration passphrase'}
              </label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphraseValue(e.target.value)}
                placeholder="••••••••"
                className="h-10 w-full border border-outline-variant bg-surface px-3 font-mono text-sm text-primary focus:border-primary"
              />
            </div>
            {status !== 'empty' && (
              <div className="flex-1">
                <label className="block font-mono text-[10px] uppercase tracking-widest text-outline mb-1">
                  Confirm passphrase
                </label>
                <input
                  type="password"
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  placeholder="••••••••"
                  className="h-10 w-full border border-outline-variant bg-surface px-3 font-mono text-sm text-primary focus:border-primary"
                />
              </div>
            )}
            <button
              type="button"
              onClick={status === 'locked' ? handleUnlock : handleSetPassphrase}
              disabled={!passphrase || (status !== 'locked' && passphrase !== confirmPassphrase)}
              className="h-10 bg-primary px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
            >
              {status === 'locked'
                ? 'Unlock'
                : status === 'legacy'
                  ? 'Migrate & encrypt'
                  : 'Set up encryption'}
            </button>
          </div>
        ) : null}

        {status === 'unlocked' && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
            <p className="font-mono text-xs text-outline">
              {bidCount} bid recovery secret(s) held in memory only.
            </p>
            <button
              type="button"
              onClick={handleBackup}
              disabled={!hasEncryptedVault}
              className="h-9 border border-primary px-3 font-heading text-[10px] font-semibold uppercase tracking-widest text-primary disabled:opacity-30 transition-colors hover:bg-surface-bright"
            >
              Backup encrypted vault
            </button>
            <input
              type="file"
              accept=".json"
              hidden
              ref={importFileInput}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setImportFile(file);
                if (file) void handleImportFile(file);
              }}
            />
            <button
              type="button"
              onClick={() => importFileInput.current?.click()}
              className="h-9 border border-outline-variant px-3 font-heading text-[10px] font-semibold uppercase tracking-widest text-outline transition-colors hover:bg-surface-bright"
            >
              Import / Recover backup
            </button>
            {hasLegacyPlaintext && (
              <button
                type="button"
                onClick={handleClearLegacy}
                className="h-9 border border-error text-error px-3 font-heading text-[10px] font-semibold uppercase tracking-widest transition-colors hover:bg-surface-bright"
              >
                Clear legacy plaintext
              </button>
            )}
            {backupReady && (
              <p className="font-mono text-xs text-tertiary">
                Backup exported (encrypted, passphrase required to restore).
              </p>
            )}
          </div>
        )}
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

      {revealPending && (
        <p className="font-mono text-xs text-outline">
          Ready to reveal {revealPending.name}.wraith. Unlock the vault above, then select Reveal
          bid again.
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
            const bidStatus = bid?.submissionStatus ?? 'committed';
            const hasCommittedBid = Boolean(bid && bidStatus === 'committed');
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
                      {hasCommittedBid
                        ? formatXlm(BigInt(bid.amountStroops))
                        : bid
                          ? 'Not committed'
                          : '—'}
                    </dd>
                  </div>
                </dl>

                {bidStatus === 'pending' && (
                  <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-outline">
                    Submission is pending or interrupted. Do not retry.
                  </p>
                )}
                {bidStatus === 'unknown' && (
                  <div className="mt-3">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-error">
                      Submission outcome is unknown. Confirm transaction status before retrying.
                    </p>
                    {bid?.transactionHash && (
                      <a
                        href={stellarTxUrl(bid.transactionHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block font-mono text-[10px] uppercase tracking-widest text-primary underline"
                      >
                        Check transaction status
                      </a>
                    )}
                  </div>
                )}
                {bidStatus === 'failed' && (
                  <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-outline">
                    Bid was not submitted. The saved secret is safe to retry.
                  </p>
                )}

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
                  {phase === 'commit' && bidStatus === 'failed' && bid && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAuction(auction);
                        setBidAmount(formatXlmInput(bid.amountStroops));
                      }}
                      className="h-9 bg-primary px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-surface"
                    >
                      Retry bid
                    </button>
                  )}
                  {phase === 'commit' && hasCommittedBid && (
                    <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                      Bid committed — return to reveal it
                    </span>
                  )}
                  {phase === 'reveal' && hasCommittedBid && bid && !bid.revealed && (
                    <button
                      type="button"
                      onClick={() => void revealBid(auction)}
                      disabled={pendingAction === `reveal:${auction.name}` || !unlocked}
                      className="h-9 bg-primary px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-surface disabled:opacity-40"
                    >
                      {pendingAction === `reveal:${auction.name}`
                        ? 'Revealing...'
                        : !unlocked
                          ? 'Unlock to reveal'
                          : 'Reveal bid'}
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
                  {(phase === 'ended' || phase === 'settled') &&
                    hasCommittedBid &&
                    bid &&
                    !isWinner && (
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

            {unlocked ? null : (
              <div className="mb-4 p-3 border border-outline-variant/50 bg-surface-bright">
                <p className="font-mono text-[10px] text-error">
                  Set up your encryption passphrase in the vault section above before placing a bid.
                </p>
              </div>
            )}

            <label className="mt-5 block font-mono text-[10px] uppercase tracking-widest text-outline">
              Bid amount (XLM)
            </label>
            <input
              autoFocus
              inputMode="decimal"
              value={bidAmount}
              onChange={(event) => setBidAmount(event.target.value)}
              placeholder="0.0"
              disabled={retryingBid}
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
              Your amount and recovery secret stay encrypted in this browser until reveal. Clearing
              site data before revealing can make the bid unrecoverable. Export a backup after
              setting your passphrase.
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
                pendingAction === `bid:${selectedAuction.name}` ||
                selectedBidCannotRetry ||
                !unlocked
              }
              className="mt-5 h-11 w-full bg-primary font-heading text-[11px] font-semibold uppercase tracking-widest text-surface disabled:opacity-30"
            >
              {pendingAction === `bid:${selectedAuction.name}`
                ? 'Confirm in wallet...'
                : retryingBid
                  ? 'Retry bid'
                  : 'Place bid'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
