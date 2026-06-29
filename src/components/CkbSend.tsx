import { useState, useCallback } from 'react';
import { ccc } from '@ckb-ccc/connector-react';
import {
  generateStealthAddress,
  decodeStealthMetaAddress,
  getDeployment,
} from '@wraith-protocol/sdk/chains/ckb';
import { useTranslation } from 'react-i18next';
import { CopyButton } from '@/components/CopyButton';
import { trackEvent } from '@/lib/telemetry';

const STEALTH_LOCK_CODE_HASH = getDeployment('ckb').contracts.stealthLockCodeHash;

export function CkbSend() {
  const { t } = useTranslation();
  const { wallet } = ccc.useCcc();
  const signer = ccc.useSigner();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [stealthInfo, setStealthInfo] = useState<{
    stealthPubKey: string;
    lockArgs: string;
  } | null>(null);

  const handleSend = useCallback(async () => {
    if (!signer) {
      setError(t('ckb.connectWalletFirst'));
      return;
    }

    setError('');
    setIsPending(true);

    try {
      if (!recipient.startsWith('st:ckb:')) {
        setError(t('ckb.validMetaAddressError'));
        setIsPending(false);
        return;
      }

      const parsed = parseFloat(amount);
      if (parsed < 95) {
        setError(t('ckb.minAmountError'));
        setIsPending(false);
        return;
      }

      const decoded = decodeStealthMetaAddress(recipient);
      const stealth = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
      setStealthInfo({ stealthPubKey: stealth.stealthPubKey, lockArgs: stealth.lockArgs });

      const capacityShannons = ccc.fixedPointFrom(amount);

      const tx = ccc.Transaction.from({
        outputs: [
          {
            lock: {
              codeHash: STEALTH_LOCK_CODE_HASH,
              hashType: 'data2',
              args: stealth.lockArgs,
            },
            capacity: capacityShannons,
          },
        ],
        outputsData: ['0x'],
      });

      await tx.completeInputsByCapacity(signer);
      await tx.completeFeeBy(signer, 1000);

      const hash = await signer.sendTransaction(tx);
      trackEvent('send_submitted');
      setTxHash(hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.transactionFailed'));
    } finally {
      setIsPending(false);
    }
  }, [signer, recipient, amount, t]);

  const reset = () => {
    setRecipient('');
    setAmount('');
    setStealthInfo(null);
    setTxHash(null);
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

  const deployment = getDeployment('ckb');

  if (!wallet) {
    return (
      <section className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          {t('ckb.network')}
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          {t('ckb.sendTitle')}
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          {t('ckb.sendConnectPrompt')}
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          {t('ckb.network')}
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          {t('ckb.sendTitle')}
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          {t('ckb.sendDescription')}
        </p>
      </div>

      {!txHash && (
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
                placeholder={t('ckb.recipientPlaceholder')}
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
              {t('ckb.amountLabel')}
            </label>
            <div className="relative">
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="95"
                className="h-12 w-full border border-outline-variant bg-surface px-4 pr-16 font-heading text-2xl text-primary placeholder:text-outline focus:border-primary"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-outline">
                CKB
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-outline-variant/30 pt-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {t('common.networkFee')}
              </span>
              <span className="font-mono text-[10px] text-on-surface-variant">
                {t('ckb.networkFeeAmount')}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {t('ckb.minCellCapacity')}
              </span>
              <span className="font-mono text-[10px] text-on-surface-variant">
                {t('ckb.minCellCapacityValue')}
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

      {txHash && stealthInfo && (
        <div className="flex flex-col gap-5 border border-outline-variant bg-surface-container p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
            <span className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface">
              {t('common.transferComplete')}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {t('ckb.stealthPublicKey')}
              </span>
              <div className="mt-0.5 flex items-center gap-2">
                <p className="truncate font-mono text-xs text-primary">
                  {stealthInfo.stealthPubKey}
                </p>
                <CopyButton text={stealthInfo.stealthPubKey} />
              </div>
            </div>

            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {t('common.transactionHash')}
              </span>
              <div className="mt-0.5 flex items-center gap-2">
                <a
                  href={`${deployment.explorerUrl}/transaction/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate font-mono text-xs text-primary underline"
                >
                  {txHash}
                </a>
                <CopyButton text={txHash} />
              </div>
            </div>
          </div>

          <button
            onClick={reset}
            className="h-11 w-full border border-outline-variant font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
          >
            {t('common.newTransfer')}
          </button>
        </div>
      )}
    </section>
  );
}
