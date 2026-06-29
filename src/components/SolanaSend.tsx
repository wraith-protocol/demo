import { useState, useCallback } from 'react';
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { buildSendSol, bytesToHex } from '@wraith-protocol/sdk/chains/solana';
import { useTranslation } from 'react-i18next';
import { solanaTxUrl, solanaAddrUrl } from '@/lib/explorer';
import { SOLANA_NETWORK } from '@/config';
import { CopyButton } from '@/components/CopyButton';
import { trackEvent } from '@/lib/telemetry';

export function SolanaSend() {
  const { t } = useTranslation();
  const { publicKey, connected, sendTransaction } = useWallet();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [stealthResult, setStealthResult] = useState<{
    stealthAddress: string;
    ephemeralPubKey: Uint8Array;
    viewTag: number;
  } | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSend = useCallback(async () => {
    if (!connected || !publicKey) {
      setError(t('common.walletNotConnected'));
      return;
    }

    setError('');
    setIsPending(true);

    try {
      if (!recipient.startsWith('st:sol:')) {
        setError(t('solana.validMetaAddressError'));
        setIsPending(false);
        return;
      }

      const lamports = BigInt(Math.round(parseFloat(amount) * LAMPORTS_PER_SOL));
      const result = buildSendSol({
        recipientMetaAddress: recipient,
        amount: lamports,
        senderPubkey: publicKey.toBase58(),
      });
      trackEvent('send_submitted');
      setStealthResult({
        stealthAddress: result.stealthAddress,
        ephemeralPubKey: result.ephemeralPubKey,
        viewTag: result.viewTag,
      });

      const connection = new Connection(SOLANA_NETWORK.rpcUrl, 'confirmed');
      const ix = result.instruction;
      const tx = new Transaction().add(
        new TransactionInstruction({
          programId: new PublicKey(ix.programId),
          keys: ix.keys.map((k) => ({
            pubkey: new PublicKey(k.pubkey),
            isSigner: k.isSigner,
            isWritable: k.isWritable,
          })),
          data: Buffer.from(ix.data),
        }),
      );

      const signature = await sendTransaction(tx, connection);
      setTxHash(signature);

      await connection.confirmTransaction(signature, 'confirmed');
      setIsSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.transactionFailed'));
    } finally {
      setIsPending(false);
    }
  }, [connected, publicKey, sendTransaction, recipient, amount, t]);

  const reset = () => {
    setRecipient('');
    setAmount('');
    setStealthResult(null);
    setTxHash(null);
    setIsSuccess(false);
    setError('');
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setRecipient(text);
    } catch {
      // Clipboard access denied
    }
  };

  if (!connected) {
    return (
      <section className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          {t('solana.network')}
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          {t('solana.sendTitle')}
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          {t('solana.sendConnectPrompt')}
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
          {t('solana.sendTitle')}
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          {t('solana.sendDescription')}
        </p>
      </div>

      {!stealthResult && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              {t('common.recipientMetaAddress')}
            </label>
            <div className="relative">
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder={t('solana.recipientPlaceholder')}
                className="h-12 w-full border border-outline-variant bg-surface px-4 pr-20 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
              />
              <button
                onClick={handlePaste}
                className="absolute right-3 top-1/2 -translate-y-1/2 font-heading text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
              >
                {t('common.paste')}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              {t('common.amount')}
            </label>
            <div className="relative">
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                className="h-12 w-full border border-outline-variant bg-surface px-4 pr-16 font-heading text-2xl text-primary placeholder:text-outline focus:border-primary"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-outline">
                SOL
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-outline-variant/30 pt-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {t('common.networkFee')}
              </span>
              <span className="font-mono text-[10px] text-on-surface-variant">
                {t('solana.networkFeeAmount')}
              </span>
            </div>
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          <button
            onClick={handleSend}
            disabled={!recipient || !amount || isPending}
            className="h-12 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {isPending ? t('common.confirmInWallet') : t('common.sendPrivately')}
          </button>
        </div>
      )}

      {stealthResult && (
        <div className="flex flex-col gap-5 border border-outline-variant bg-surface-container p-5 sm:p-6">
          <div className="flex items-center gap-2">
            {isSuccess ? (
              <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
            ) : (
              <span className="inline-block h-1.5 w-1.5 animate-pulse bg-primary"></span>
            )}
            <span className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface">
              {isSuccess ? t('common.transferComplete') : t('common.pending')}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {t('common.stealthAddress')}
              </span>
              <div className="mt-0.5 flex items-center gap-2">
                <a
                  href={solanaAddrUrl(stealthResult.stealthAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate font-mono text-xs text-primary underline"
                >
                  {stealthResult.stealthAddress}
                </a>
                <CopyButton text={stealthResult.stealthAddress} />
              </div>
            </div>

            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {t('common.ephemeralPublicKey')}
              </span>
              <p className="mt-0.5 truncate font-mono text-xs text-on-surface-variant">
                {bytesToHex(stealthResult.ephemeralPubKey)}
              </p>
            </div>

            {txHash && (
              <div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                  {t('common.transactionHash')}
                </span>
                <div className="mt-0.5 flex items-center gap-2">
                  <a
                    href={solanaTxUrl(txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate font-mono text-xs text-primary underline"
                  >
                    {txHash}
                  </a>
                  <CopyButton text={txHash} />
                </div>
              </div>
            )}
          </div>

          {isSuccess && (
            <button
              onClick={reset}
              className="h-11 w-full border border-outline-variant font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
            >
              {t('common.newTransfer')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
