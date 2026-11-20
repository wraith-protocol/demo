import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  deriveStealthKeys,
  encodeStealthMetaAddress,
  scanAnnouncements,
  fetchAnnouncements,
  signSolanaTransaction,
  STEALTH_SIGNING_MESSAGE,
} from '@wraith-protocol/sdk/chains/solana';
import type { MatchedAnnouncement } from '@wraith-protocol/sdk/chains/solana';
import { useTranslation } from 'react-i18next';
import { useStealthKeys } from '@/context/StealthKeysContext';
import { EmptyState } from '@/components/EmptyState';
import { CopyButton } from '@/components/CopyButton';
import { trackEvent } from '@/lib/telemetry';
import { solanaTxUrl, solanaAddrUrl } from '@/lib/explorer';
import { SOLANA_NETWORK } from '@/config';

function SolanaStealthRow({
  match,
  onWithdrawn,
}: {
  match: MatchedAnnouncement;
  onWithdrawn: () => void;
}) {
  const { t } = useTranslation();
  const [balance, setBalance] = useState<string | null>(null);
  const [loadingBal, setLoadingBal] = useState(true);
  const [dest, setDest] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawHash, setWithdrawHash] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showKey, setShowKey] = useState(false);

  const scalarHex = match.stealthPrivateScalar.toString(16).padStart(64, '0');

  useEffect(() => {
    (async () => {
      try {
        const connection = new Connection(SOLANA_NETWORK.rpcUrl, 'confirmed');
        const { PublicKey } = await import('@solana/web3.js');
        const bal = await connection.getBalance(new PublicKey(match.stealthAddress));
        setBalance((bal / LAMPORTS_PER_SOL).toFixed(6));
      } catch {
        setBalance('0');
      } finally {
        setLoadingBal(false);
      }
    })();
  }, [match.stealthAddress]);

  const handleWithdraw = async () => {
    if (!dest) return;
    setError('');
    setWithdrawing(true);

    try {
      const { PublicKey, Transaction, SystemProgram } = await import('@solana/web3.js');
      const connection = new Connection(SOLANA_NETWORK.rpcUrl, 'confirmed');

      const stealthPubkey = new PublicKey(match.stealthAddress);
      const destPubkey = new PublicKey(dest);

      const bal = await connection.getBalance(stealthPubkey);
      if (bal === 0) throw new Error('No balance');

      const fee = 5000;
      const sendAmount = bal - fee;
      if (sendAmount <= 0) throw new Error('Balance too low to cover fees');

      const tx = new Transaction();
      tx.add(
        SystemProgram.transfer({
          fromPubkey: stealthPubkey,
          toPubkey: destPubkey,
          lamports: sendAmount,
        }),
      );

      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = stealthPubkey;

      const message = tx.serializeMessage();
      const signature = signSolanaTransaction(
        message,
        match.stealthPrivateScalar,
        match.stealthPubKeyBytes,
      );

      tx.addSignature(stealthPubkey, Buffer.from(signature));

      const txId = await connection.sendRawTransaction(tx.serialize());
      await connection.confirmTransaction(txId, 'confirmed');

      setWithdrawHash(txId);
      trackEvent('withdraw');
      onWithdrawn();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.transactionFailed'));
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            {t('common.stealthAddress')}
          </span>
          <div className="mt-0.5 flex items-center gap-2">
            <a
              href={solanaAddrUrl(match.stealthAddress)}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate font-mono text-xs text-primary underline"
            >
              {match.stealthAddress}
            </a>
            <CopyButton text={match.stealthAddress} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {loadingBal ? (
            <span className="font-mono text-xs text-outline">...</span>
          ) : balance && parseFloat(balance) > 0 ? (
            <>
              <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
              <span className="font-heading text-lg font-bold text-on-surface">{balance} SOL</span>
            </>
          ) : (
            <span className="font-mono text-xs text-outline">{t('common.empty')}</span>
          )}
        </div>
      </div>

      {!withdrawHash && balance && parseFloat(balance) > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
            {t('common.withdrawTo')}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              placeholder={t('solana.destinationPlaceholder')}
              className="h-10 flex-1 border border-outline-variant bg-surface px-3 font-mono text-xs text-primary placeholder:text-outline focus:border-primary"
            />
            <button
              onClick={handleWithdraw}
              disabled={!dest || withdrawing}
              className="h-10 bg-primary px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
            >
              {withdrawing ? '...' : t('common.withdraw')}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-error">{error}</p>}

      {withdrawHash && (
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
          <span className="font-mono text-[10px] text-on-surface-variant">
            {t('common.withdrawn')} —{' '}
            <a
              href={solanaTxUrl(withdrawHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              {withdrawHash.slice(0, 14)}...
            </a>
          </span>
        </div>
      )}

      <div className="border-t border-outline-variant/30 pt-3">
        {!showKey ? (
          <button
            onClick={() => setShowKey(true)}
            className="font-mono text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
          >
            {t('common.revealSecretKey')}
          </button>
        ) : (
          <div className="border border-error/20 bg-error/5 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-[9px] font-semibold uppercase tracking-widest text-error">
                {t('common.stealthKey')}
              </span>
              <CopyButton text={scalarHex} />
            </div>
            <code className="break-all font-mono text-[11px] text-on-surface">{scalarHex}</code>
          </div>
        )}
      </div>
    </div>
  );
}

export function SolanaReceive() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { connected, signMessage } = useWallet();
  const { solanaKeys, solanaMetaAddress, setSolanaKeys, setSolanaMetaAddress } = useStealthKeys();

  const [isDerivingKeys, setIsDerivingKeys] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [matched, setMatched] = useState<MatchedAnnouncement[]>([]);
  const [hasScanned, setHasScanned] = useState(false);
  const [error, setError] = useState('');

  const deriveKeys = useCallback(async () => {
    if (!signMessage) {
      setError(t('solana.walletSigningNotSupported'));
      return;
    }
    setIsDerivingKeys(true);
    setError('');
    try {
      const msgBytes = new TextEncoder().encode(STEALTH_SIGNING_MESSAGE);
      const signature = await signMessage(msgBytes);
      const derived = deriveStealthKeys(signature);
      setSolanaKeys(derived);
      const meta = encodeStealthMetaAddress(derived.spendingPubKey, derived.viewingPubKey);
      setSolanaMetaAddress(meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.keyDerivationFailed'));
    } finally {
      setIsDerivingKeys(false);
    }
  }, [signMessage, setSolanaKeys, setSolanaMetaAddress, t]);

  const scanPayments = useCallback(async () => {
    if (!solanaKeys) return;
    setIsScanning(true);
    setError('');
    try {
      const announcements = await fetchAnnouncements('solana');
      const results = scanAnnouncements(
        announcements,
        solanaKeys.viewingKey,
        solanaKeys.spendingPubKey,
        solanaKeys.spendingScalar,
      );
      setMatched(results);
      setHasScanned(true);
      trackEvent('scan_triggered');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.scanFailed'));
    } finally {
      setIsScanning(false);
    }
  }, [solanaKeys, t]);

  if (!connected) {
    return (
      <section className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          {t('solana.network')}
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          {t('solana.receiveTitle')}
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          {t('solana.receiveConnectPrompt')}
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          {t('solana.network')}
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          {t('solana.receiveTitle')}
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          {t('solana.receiveDescription')}
        </p>
      </div>

      {!solanaKeys && (
        <div className="flex flex-col gap-4">
          <button
            onClick={deriveKeys}
            disabled={isDerivingKeys}
            className="h-12 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {isDerivingKeys ? t('common.signingInWallet') : t('common.deriveKeys')}
          </button>
          {error && <p className="text-sm text-error">{error}</p>}
        </div>
      )}

      {solanaKeys && solanaMetaAddress && (
        <>
          <div className="border border-outline-variant bg-surface-container p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {t('common.yourStealthMetaAddress')}
              </span>
              <CopyButton text={solanaMetaAddress} />
            </div>
            <code className="block break-all font-mono text-xs leading-relaxed text-primary">
              {solanaMetaAddress}
            </code>
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={scanPayments}
              disabled={isScanning}
              className="h-12 bg-primary px-6 font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
            >
              {isScanning ? t('common.scanning') : t('common.scanForPayments')}
            </button>
            {hasScanned && (
              <span className="font-mono text-xs text-on-surface-variant">
                {t('common.transfersFound', { count: matched.length })}
              </span>
            )}
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          {matched.length > 0 && (
            <div className="flex flex-col gap-4">
              {matched.map((m, i) => (
                <SolanaStealthRow key={i} match={m} onWithdrawn={() => {}} />
              ))}
            </div>
          )}

          {hasScanned && matched.length === 0 && (
            <EmptyState
              illustration={
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 48 48"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="16" cy="16" r="6" />
                  <circle cx="32" cy="16" r="6" />
                  <path d="M6 38c0-5.523 4.477-10 10-10" />
                  <path d="M42 38c0-5.523-4.477-10-10-10" />
                  <path d="M16 28c-5.523 0-10 4.477-10 10" strokeDasharray="2 2" />
                  <path d="M32 28c5.523 0 10 4.477 10 10" strokeDasharray="2 2" />
                  <line x1="16" y1="22" x2="16" y2="28" />
                  <line x1="32" y1="22" x2="32" y2="28" />
                </svg>
              }
              title={t('common.noTransfersFound')}
              description={t('common.noTransfersMatchedKeys')}
              primaryCTA={{ label: t('common.send'), onClick: () => navigate('/send') }}
            />
          )}
        </>
      )}
    </section>
  );
}
