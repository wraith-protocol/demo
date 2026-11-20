import { useEffect, useState } from 'react';
import {
  useAccount,
  useBalance,
  usePublicClient,
  useSendTransaction,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { buildSendStealth, buildResolveName } from '@wraith-protocol/sdk/chains/evm';
import type { HexString, BuildSendStealthResult } from '@wraith-protocol/sdk/chains/evm';
import { useTranslation } from 'react-i18next';
import { horizenTxUrl, horizenAddrUrl } from '@/lib/explorer';
import { horizenTestnet } from '@/config';
import { CopyButton } from '@/components/CopyButton';
import { IntentSummary } from '@/components/IntentSummary';
import { buildEvmSendIntent, verifyEvmSubmittedTransaction } from '@/lib/txIntent';
import { trackEvent } from '@/lib/telemetry';

export function HorizenSend() {
  const { t } = useTranslation();
  const { isConnected, address } = useAccount();
  const { data: balanceData } = useBalance({ address });
  const publicClient = usePublicClient();

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [stealthResult, setStealthResult] = useState<BuildSendStealthResult | null>(null);
  const [pendingIntent, setPendingIntent] = useState<{
    intent: ReturnType<typeof buildEvmSendIntent>;
    request: { to: `0x${string}`; data: `0x${string}`; value?: bigint };
  } | null>(null);

  const { sendTransaction, data: txHash, isPending } = useSendTransaction();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const isMetaAddress = recipient.startsWith('st:eth:');
  const cleanedName = recipient.replace(/\.wraith$/i, '').toLowerCase();
  const isWraithName = !isMetaAddress && cleanedName.length >= 3 && /^[a-z0-9]+$/.test(cleanedName);

  const handleSend = async () => {
    setError('');

    let metaAddress = recipient;

    try {
      if (isWraithName) {
        const resolveCall = buildResolveName({ name: cleanedName, chain: 'horizen' });
        const response = await fetch(horizenTestnet.rpcUrls.default.http[0], {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_call',
            params: [{ to: resolveCall.to, data: resolveCall.data }, 'latest'],
          }),
        });
        const json = await response.json();
        if (!json.result || json.result === '0x' || json.result.length <= 66) {
          setError(t('common.nameNotFound'));
          return;
        }
        const metaBytes = ('0x' + json.result.slice(130).replace(/0+$/, '')) as HexString;
        metaAddress = `st:eth:${metaBytes}`;
      }

      if (!metaAddress.startsWith('st:eth:')) {
        setError('Enter a valid meta-address (st:eth:0x...) or .wraith name');
        return;
      }

      if (!address) {
        setError(t('common.walletNotConnected'));
        return;
      }

      const result = buildSendStealth({
        recipientMetaAddress: metaAddress,
        amount,
        chain: 'horizen',
      });

      const request = {
        to: result.transaction.to as `0x${string}`,
        data: result.transaction.data as `0x${string}`,
        value: result.transaction.value,
      };

      setStealthResult(result);
      setPendingIntent({
        intent: buildEvmSendIntent({
          chainId: horizenTestnet.id,
          account: address,
          to: request.to,
          stealthAddress: result.stealthAddress,
          data: request.data,
          value: request.value ?? 0n,
        }),
        request,
      });
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.transactionFailed'));
    }
  };

  const handleConfirm = () => {
    if (!pendingIntent) return;
    if (!address || pendingIntent.intent.account !== address.toLowerCase()) {
      setPendingIntent(null);
      setStealthResult(null);
      setError('The wallet account changed since this transfer was reviewed. Review it again.');
      return;
    }

    setError('');
    trackEvent('send_submitted');
    sendTransaction(pendingIntent.request);
  };

  useEffect(() => {
    if (!txHash || !pendingIntent || !publicClient) return;

    let cancelled = false;
    publicClient
      .getTransaction({ hash: txHash })
      .then((submitted) => {
        if (cancelled) return;
        const verification = verifyEvmSubmittedTransaction(pendingIntent.intent, {
          chainId: submitted.chainId,
          from: submitted.from,
          to: submitted.to,
          value: submitted.value,
          input: submitted.input,
        });
        if (!verification.ok) {
          setError(
            `The wallet submitted a transaction that does not match the confirmed intent (${verification.mismatches
              .map((mismatch) => mismatch.field)
              .join(', ')}). Do not retry without a fresh review.`,
          );
        }
      })
      .catch(() => {
        // Receipt verification is best-effort; the pending state still reflects
        // the wallet's reported hash.
      });

    return () => {
      cancelled = true;
    };
  }, [txHash, pendingIntent, publicClient]);

  const reset = () => {
    setRecipient('');
    setAmount('');
    setStealthResult(null);
    setPendingIntent(null);
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

  const handleMax = () => {
    if (balanceData) {
      const maxVal = parseFloat(balanceData.formatted);
      const safeMax = Math.max(0, maxVal - 0.001).toFixed(6);
      setAmount(safeMax);
    }
  };

  if (!isConnected) {
    return (
      <section className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          {t('horizen.network')}
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          {t('horizen.sendTitle')}
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          {t('horizen.sendConnectPrompt')}
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          {t('horizen.network')}
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          {t('horizen.sendTitle')}
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          {t('horizen.sendDescription')}
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
                placeholder={t('horizen.recipientPlaceholder')}
                className="h-12 w-full border border-outline-variant bg-surface px-4 pr-20 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
              />
              <button
                onClick={handlePaste}
                className="absolute right-3 top-1/2 -translate-y-1/2 font-heading text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
              >
                {t('common.paste')}
              </button>
            </div>
            {isWraithName && (
              <span className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
                {cleanedName}.wraith
              </span>
            )}
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
                className="h-12 w-full border border-outline-variant bg-surface px-4 pr-24 font-heading text-2xl text-primary placeholder:text-outline focus:border-primary"
              />
              <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
                <button
                  onClick={handleMax}
                  className="font-heading text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
                >
                  {t('common.max')}
                </button>
                <span className="font-mono text-xs text-outline">ETH</span>
              </div>
            </div>
            {balanceData && (
              <span className="font-mono text-[10px] text-outline">
                {t('common.balance')}: {parseFloat(balanceData.formatted).toFixed(6)} ETH
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-outline-variant/30 pt-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {t('common.networkFee')}
              </span>
              <span className="font-mono text-[10px] text-on-surface-variant">
                {t('common.paidBySender')}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {t('common.announcerContract')}
              </span>
              <span className="font-mono text-[10px] text-on-surface-variant">
                {t('horizen.announcerContractName')}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {t('common.expectedConfirmation')}
              </span>
              <span className="font-mono text-[10px] text-on-surface-variant">
                {t('common.seconds_approx')}
              </span>
            </div>
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          <button
            onClick={handleSend}
            disabled={!recipient || !amount || isPending}
            className="h-12 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            Review transfer
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
              {isConfirming
                ? t('common.confirming')
                : isSuccess
                  ? t('common.transferComplete')
                  : t('common.pending')}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {t('common.stealthAddress')}
              </span>
              <div className="mt-0.5 flex items-center gap-2">
                <a
                  href={horizenAddrUrl(stealthResult.stealthAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate font-mono text-xs text-primary underline"
                >
                  {stealthResult.stealthAddress}
                </a>
                <CopyButton text={stealthResult.stealthAddress} />
              </div>
            </div>

            {txHash && (
              <div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                  {t('common.transactionHash')}
                </span>
                <div className="mt-0.5 flex items-center gap-2">
                  <a
                    href={horizenTxUrl(txHash)}
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

            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {t('common.ephemeralPublicKey')}
              </span>
              <p className="mt-0.5 truncate font-mono text-xs text-on-surface-variant">
                {stealthResult.ephemeralPubKey}
              </p>
            </div>
          </div>

          {pendingIntent && !txHash && (
            <>
              <IntentSummary intent={pendingIntent.intent} />
              {error && <p className="text-sm text-error">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={reset}
                  disabled={isPending}
                  className="h-11 flex-1 border border-outline-variant font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-30"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={isPending}
                  className="h-11 flex-1 bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
                >
                  {isPending ? t('common.confirmInWallet') : 'Confirm & send'}
                </button>
              </div>
            </>
          )}

          {txHash && error && <p className="text-sm text-error">{error}</p>}

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
