import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { decodeStealthMetaAddress } from '@wraith-protocol/sdk/chains/stellar';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { useStealthKeys } from '@/context/StealthKeysContext';
import { useContacts } from '@/store/contactsStore';
import { useNameHistory } from '@/store/nameHistoryStore';
import { useNameWatchlistStore } from '@/store/nameWatchlistStore';
import { stellarTxUrl } from '@/lib/explorer';
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
  type NameAuction,
  type NameAuctionConfig,
} from '@/lib/stellar/names';

// Display-only label lookup: an undisployed names contract resolves to an empty
// address so the page still renders, while every auction call fails closed.
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
  const vaultStatus = useNameWatchlistStore((state) => state.status);
  const vaultErrorState = useNameWatchlistStore((state) => state.error);
  const hasLegacyPlaintext = useNameWatchlistStore((state) => state.hasLegacyPlaintext);
  const hasEncryptedVault = useNameWatchlistStore((state) => state.hasEncryptedVault);
  const watchAuction = useNameWatchlistStore((state) => state.watchAuction);
  const unwatchAuction = useNameWatchlistStore((state) => state.unwatchAuction);
  const saveBid = useNameWatchlistStore((state) => state.saveBid);
  const markBidRevealed = useNameWatchlistStore((state) => state.markBidRevealed);
  const removeBid = useNameWatchlistStore((state) => state.removeBid);
  const setVaultPassphrase = useNameWatchlistStore((state) => state.setPassphrase);
  const unlockVault = useNameWatchlistStore((state) => state.unlock);
  const lockVault = useNameWatchlistStore((state) => state.lock);
  const exportVaultBackup = useNameWatchlistStore((state) => state.exportBackup);
  const importVaultBackup = useNameWatchlistStore((state) => state.importBackup);
  const clearLegacyVault = useNameWatchlistStore((state) => state.clearLegacy);

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
  const [vaultPassphrase, setVaultPassphraseValue] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [vaultError, setVaultError] = useState('');
  const [vaultBusy, setVaultBusy] = useState(false);
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const backupFileInput = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (vaultStatus === 'locked' || vaultStatus === 'error') {
      setVaultPassphraseValue('');
      setConfirmPassphrase('');
    }
  }, [vaultStatus]);

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
      await watchAuction({ name: auction.name, endsAt: auction.revealEnd });
      setLookupName('');
    } catch (trackError) {
      setError(trackError instanceof Error ? trackError.message : 'Failed to find auction');
    } finally {
      setPendingAction('');
    }
  };

  const toggleAuctionWatch = async (auction: NameAuction, isWatched: boolean) => {
    try {
      if (isWatched) await unwatchAuction(auction.name);
      else await watchAuction({ name: auction.name, endsAt: auction.revealEnd });
    } catch (storageError) {
      setError(
        storageError instanceof Error
          ? storageError.message
          : 'Unable to update the auction watchlist.',
      );
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
    if (vaultStatus !== 'unlocked') {
      setError('Unlock the recovery vault before placing a bid.');
      return;
    }
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
      await saveBid({
        name: selectedAuction.name,
        amountStroops: parsedBid.toString(),
        depositStroops: parsedBid.toString(),
        saltHex,
        revealed: false,
      });
      const submitted = await submitAuctionTransaction(action, () =>
        buildCommitNameBidTransaction(address, {
          name: selectedAuction.name,
          commitmentHex,
          deposit: parsedBid,
        }),
      );
      if (submitted) {
        await watchAuction({ name: selectedAuction.name, endsAt: selectedAuction.revealEnd });
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
    if (!address || vaultStatus !== 'unlocked') {
      setError('Unlock the recovery vault before revealing a bid.');
      return;
    }
    const bid = bids[auction.name];
    if (!bid) return;
    const submitted = await submitAuctionTransaction(`reveal:${auction.name}`, () =>
      buildRevealNameBidTransaction(address, {
        name: auction.name,
        amount: BigInt(bid.amountStroops),
        saltHex: bid.saltHex,
      }),
    );
    if (submitted) {
      try {
        await markBidRevealed(auction.name);
      } catch (storageError) {
        setError(
          storageError instanceof Error
            ? `Bid revealed, but recovery status could not be updated: ${storageError.message}`
            : 'Bid revealed, but recovery status could not be updated.',
        );
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
      } catch (storageError) {
        setError(
          storageError instanceof Error
            ? `Name claimed, but local recovery data could not be updated: ${storageError.message}`
            : 'Name claimed, but local recovery data could not be updated.',
        );
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
      } catch (storageError) {
        setError(
          storageError instanceof Error
            ? `Refund submitted, but local recovery data could not be updated: ${storageError.message}`
            : 'Refund submitted, but local recovery data could not be updated.',
        );
      }
    }
  };

  const configureVault = async () => {
    setVaultBusy(true);
    setVaultError('');
    try {
      if (hasEncryptedVault) {
        await unlockVault(vaultPassphrase);
      } else {
        if (vaultPassphrase !== confirmPassphrase) {
          throw new Error('The passphrases do not match.');
        }
        await setVaultPassphrase(vaultPassphrase);
      }
      setVaultPassphraseValue('');
      setConfirmPassphrase('');
    } catch (vaultOperationError) {
      setVaultError(
        vaultOperationError instanceof Error
          ? vaultOperationError.message
          : 'Unable to configure the recovery vault.',
      );
    } finally {
      setVaultBusy(false);
    }
  };

  const downloadBackup = async () => {
    setVaultError('');
    try {
      const backup = await exportVaultBackup();
      const url = URL.createObjectURL(new Blob([backup], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'wraith-name-auction-backup.json';
      link.click();
      URL.revokeObjectURL(url);
    } catch (vaultOperationError) {
      setVaultError(
        vaultOperationError instanceof Error
          ? vaultOperationError.message
          : 'Unable to export the recovery backup.',
      );
    }
  };

  const importBackup = async () => {
    if (!backupFile) {
      setVaultError('Choose an encrypted recovery backup first.');
      return;
    }
    if (hasEncryptedVault && !window.confirm('Replace the current encrypted recovery vault?')) {
      return;
    }
    setVaultBusy(true);
    setVaultError('');
    try {
      await importVaultBackup(await backupFile.text(), vaultPassphrase, {
        replace: hasEncryptedVault,
      });
      setBackupFile(null);
      setVaultPassphraseValue('');
      if (backupFileInput.current) backupFileInput.current.value = '';
    } catch (vaultOperationError) {
      setVaultError(
        vaultOperationError instanceof Error
          ? vaultOperationError.message
          : 'Unable to import the recovery backup.',
      );
    } finally {
      setVaultBusy(false);
    }
  };

  const removeLegacySecrets = async () => {
    if (
      !window.confirm(
        'The encrypted recovery vault has been verified. Permanently delete the legacy plaintext bid secrets?',
      )
    ) {
      return;
    }
    setVaultError('');
    try {
      await clearLegacyVault();
    } catch (vaultOperationError) {
      setVaultError(
        vaultOperationError instanceof Error
          ? vaultOperationError.message
          : 'Unable to remove legacy plaintext recovery data.',
      );
    }
  };

  const unlocked = vaultStatus === 'unlocked';
  const vaultPanel = (
    <section className="border border-outline-variant bg-surface-container p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-heading text-sm font-semibold uppercase tracking-widest text-on-surface">
            Bid recovery vault
          </h2>
          <p className="mt-2 max-w-2xl font-body text-xs leading-relaxed text-on-surface-variant">
            Bid amounts and salts are encrypted in this browser. Unlock the vault before placing or
            revealing a bid, and export a backup before clearing browser data.
          </p>
        </div>
        {unlocked && (
          <button
            type="button"
            onClick={() => {
              lockVault();
              setVaultPassphraseValue('');
              setConfirmPassphrase('');
            }}
            className="h-9 border border-outline-variant px-3 font-heading text-[10px] font-semibold uppercase tracking-widest text-primary"
          >
            Lock vault
          </button>
        )}
      </div>

      {hasLegacyPlaintext && (
        <p
          role="status"
          className="mt-4 border border-outline-variant px-3 py-2 font-body text-xs text-on-surface-variant"
        >
          Legacy plaintext bid secrets were found. They remain untouched until encrypted recovery
          has been verified and you explicitly confirm deletion.
        </p>
      )}

      {!unlocked && (
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <label
              htmlFor="auction-vault-passphrase"
              className="font-mono text-[10px] uppercase tracking-widest text-outline"
            >
              {hasEncryptedVault ? 'Vault passphrase' : 'Create a vault passphrase'}
            </label>
            <input
              id="auction-vault-passphrase"
              type="password"
              autoComplete={hasEncryptedVault ? 'current-password' : 'new-password'}
              value={vaultPassphrase}
              onChange={(event) => setVaultPassphraseValue(event.target.value)}
              className="mt-2 h-10 w-full border border-outline-variant bg-surface px-3 font-body text-sm text-on-surface"
            />
            {!hasEncryptedVault && (
              <>
                <label
                  htmlFor="auction-vault-confirm"
                  className="mt-3 block font-mono text-[10px] uppercase tracking-widest text-outline"
                >
                  Confirm passphrase
                </label>
                <input
                  id="auction-vault-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassphrase}
                  onChange={(event) => setConfirmPassphrase(event.target.value)}
                  className="mt-2 h-10 w-full border border-outline-variant bg-surface px-3 font-body text-sm text-on-surface"
                />
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => void configureVault()}
            disabled={vaultBusy || !vaultPassphrase}
            className="h-10 self-end bg-primary px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-surface disabled:opacity-40"
          >
            {vaultBusy
              ? 'Working...'
              : hasEncryptedVault
                ? 'Unlock vault'
                : 'Encrypt recovery data'}
          </button>
        </div>
      )}

      {hasEncryptedVault && (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <button
            type="button"
            onClick={() => void downloadBackup()}
            className="h-9 border border-primary px-3 font-heading text-[10px] font-semibold uppercase tracking-widest text-primary"
          >
            Export encrypted backup
          </button>
          {hasLegacyPlaintext && unlocked && (
            <button
              type="button"
              onClick={() => void removeLegacySecrets()}
              className="h-9 border border-outline-variant px-3 font-heading text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant"
            >
              Delete legacy plaintext
            </button>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-outline-variant/40 pt-4">
        <div>
          <label
            htmlFor="auction-backup-file"
            className="font-mono text-[10px] uppercase tracking-widest text-outline"
          >
            Recover from encrypted backup
          </label>
          <input
            ref={backupFileInput}
            id="auction-backup-file"
            type="file"
            accept="application/json,.json"
            onChange={(event) => setBackupFile(event.target.files?.[0] ?? null)}
            className="mt-2 block max-w-full font-mono text-xs text-on-surface-variant"
          />
        </div>
        <button
          type="button"
          onClick={() => void importBackup()}
          disabled={vaultBusy || !backupFile || !vaultPassphrase}
          className="h-9 border border-primary px-3 font-heading text-[10px] font-semibold uppercase tracking-widest text-primary disabled:opacity-40"
        >
          Import encrypted backup
        </button>
      </div>

      {(vaultError || vaultErrorState) && (
        <p role="alert" className="mt-3 font-body text-xs text-error">
          {vaultError || vaultErrorState}
        </p>
      )}
    </section>
  );

  if (!isConnected) {
    return (
      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Stellar / Names / Auctions
          </span>
          <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
            Name Auctions
          </h1>
          <p className="font-body text-sm text-on-surface-variant">
            Connect your Stellar wallet to bid on premium Wraith Names.
          </p>
        </div>
        {vaultPanel}
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

      {vaultPanel}

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
                    onClick={() => void toggleAuctionWatch(auction, isWatched)}
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
                      disabled={!unlocked}
                      className="h-9 bg-primary px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-surface disabled:opacity-40"
                    >
                      {unlocked ? 'Place bid' : 'Unlock vault to bid'}
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
              Your bid amount and salt are encrypted before the commitment is signed. Keep an
              encrypted backup if you may need to recover this bid on another device.
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
                !unlocked ||
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
