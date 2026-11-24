import { useEffect, useMemo, useState } from 'react';
import {
  useAccount,
  useBalance,
  usePublicClient,
  useSendTransaction,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { buildSendStealth, buildResolveName } from '@wraith-protocol/sdk/chains/evm';
import type { HexString } from '@wraith-protocol/sdk/chains/evm';
import { useTranslation } from 'react-i18next';
import { horizenTxUrl, horizenAddrUrl } from '@/lib/explorer';
import { horizenTestnet } from '@/config';
import { CopyButton } from '@/components/CopyButton';
import { PendingSubmissionNotice } from '@/components/PendingSubmissionNotice';
import { trackEvent } from '@/lib/telemetry';
import { usePendingChainSubmission } from '@/hooks/usePendingChainSubmission';
import { useActivityStore } from '@/stores/activityStore';
import {
  createEvmSubmissionAdapter,
  evmSubmissionScope,
  resolveEvmNonce,
} from '@/lib/evmSubmission';
import {
  isAmbiguousSubmissionError,
  releaseSubmissionDraft,
  reserveSubmissionOperationId,
  submitChainTransactionOnce,
} from '@/lib/submissionIdempotency';

interface StealthSummary {
  stealthAddress: string;
  ephemeralPubKey: string;
}

export function HorizenSend() {
  const { t } = useTranslation();
  const { isConnected, address, chainId } = useAccount();
  const { data: balanceData } = useBalance({ address });
  const publicClient = usePublicClient({ chainId: horizenTestnet.id });
  const addActivity = useActivityStore((state) => state.addEntry);
  const updateActivity = useActivityStore((state) => state.updateStatus);

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [stealthResult, setStealthResult] = useState<StealthSummary | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { sendTransactionAsync } = useSendTransaction();
  const {
    data: receipt,
    error: receiptError,
    isLoading: isConfirming,
  } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: horizenTestnet.id,
  });
  const isSuccess = receipt?.status === 'success';

  const scope = useMemo(
    () => (address && chainId ? evmSubmissionScope(chainId, address) : null),
    [address, chainId],
  );
  const adapter = useMemo(
    () => (publicClient ? createEvmSubmissionAdapter(publicClient) : null),
    [publicClient],
  );
  const pending = usePendingChainSubmission(scope, adapter);
  const isPending = isSubmitting || pending.blocked;

  useEffect(() => {
    if (!txHash || !receipt) return;
    updateActivity(txHash, receipt.status === 'success' ? 'confirmed' : 'failed');
    if (receipt.status !== 'success') setError(t('submission.failedOnChain'));
    void pending.check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txHash, receipt]);

  useEffect(() => {
    if (!txHash || !receiptError) return;
    setError(receiptError.message);
    void pending.check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txHash, receiptError]);

  const isMetaAddress = recipient.startsWith('st:eth:');
  const cleanedName = recipient.replace(/\.wraith$/i, '').toLowerCase();
  const isWraithName = !isMetaAddress && cleanedName.length >= 3 && /^[a-z0-9]+$/.test(cleanedName);

  const handleSend = async () => {
    if (isSubmitting || pending.blocked) return;
    if (!address || !scope || !adapter || !publicClient) {
      setError(t('common.walletNotConnected'));
      return;
    }
    if (chainId !== horizenTestnet.id) {
      setError(`Switch your wallet to ${horizenTestnet.name} before sending.`);
      return;
    }

    setError('');
    setIsSubmitting(true);
    let metaAddress = recipient;
    let draft = '';
    let operationId = '';

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

      draft = JSON.stringify({
        chain: 'evm',
        network: scope.network,
        wallet: scope.account,
        recipient: metaAddress,
        amount: amount.trim(),
      });
      operationId = await reserveSubmissionOperationId(draft);

      const result = await submitChainTransactionOnce({
        operationId,
        scope,
        adapter,
        prepare: async ({ pinnedNonce }) => {
          const nonce = await resolveEvmNonce(publicClient, address, pinnedNonce);
          const built = buildSendStealth({
            recipientMetaAddress: metaAddress,
            amount,
            chain: 'horizen',
          });
          setStealthResult({
            stealthAddress: built.stealthAddress,
            ephemeralPubKey: built.ephemeralPubKey,
          });
          trackEvent('send_submitted');
          return {
            identity: { kind: 'evm', chainId: horizenTestnet.id, from: scope.account, nonce },
            metadata: {
              stealthAddress: built.stealthAddress,
              ephemeralPubKey: built.ephemeralPubKey,
            },
            broadcast: () =>
              sendTransactionAsync({
                to: built.transaction.to as `0x${string}`,
                data: built.transaction.data as `0x${string}`,
                value: built.transaction.value,
                nonce,
                chainId: horizenTestnet.id,
              }),
          };
        },
      });

      const { metadata } = result.record;
      if (typeof metadata?.stealthAddress === 'string') {
        setStealthResult({
          stealthAddress: metadata.stealthAddress,
          ephemeralPubKey: String(metadata.ephemeralPubKey ?? ''),
        });
      }
      if (result.status === 'failed') {
        setStealthResult(null);
        setError(t('submission.failedOnChain'));
        await releaseSubmissionDraft(draft, operationId);
        return;
      }
      setTxHash(result.txHash as `0x${string}`);
      addActivity({
        id: result.txHash,
        chain: 'horizen',
        wallet: scope.account,
        kind: 'stealth-send',
        direction: 'out',
        status: result.status === 'confirmed' ? 'confirmed' : 'pending',
        amount: amount.trim(),
        recipient: metaAddress,
        timestamp: Date.now(),
      });
      await releaseSubmissionDraft(draft, operationId);
    } catch (err) {
      if (!isAmbiguousSubmissionError(err)) setStealthResult(null);
      setError(err instanceof Error ? err.message : t('common.transactionFailed'));
    } finally {
      setIsSubmitting(false);
      pending.refresh();
    }
  };

  const reset = () => {
    setRecipient('');
    setAmount('');
    setStealthResult(null);
    setTxHash(undefined);
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

      <PendingSubmissionNotice pending={pending} txUrl={horizenTxUrl} />

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
            {isSubmitting ? t('common.confirmInWallet') : t('common.sendPrivately')}
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

          {error && <p className="text-sm text-error">{error}</p>}

          {(isSuccess || (!isSubmitting && !pending.blocked && !txHash)) && (
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
