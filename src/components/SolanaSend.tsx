import { useCallback, useMemo, useState } from 'react';
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import { buildSendSol, bytesToHex } from '@wraith-protocol/sdk/chains/solana';
import { useTranslation } from 'react-i18next';
import { useSendDraft } from '@/hooks/useSendDraft';
import { beginTransactionActivity, transactionBlockReason } from '@/lib/transactionActivity';
import { solanaTxUrl, solanaAddrUrl } from '@/lib/explorer';
import { SOLANA_NETWORK } from '@/config';
import { CopyButton } from '@/components/CopyButton';
import { IntentSummary } from '@/components/IntentSummary';
import { PendingSubmissionNotice } from '@/components/PendingSubmissionNotice';
import {
  buildSolanaSendIntent,
  verifySolanaSignedTransaction,
  type TransactionIntent,
} from '@/lib/txIntent';
import { trackEvent } from '@/lib/telemetry';
import { usePendingChainSubmission } from '@/hooks/usePendingChainSubmission';
import { useActivityStore } from '@/stores/activityStore';
import {
  createSolanaSubmissionAdapter,
  encodeSignedTransaction,
  solanaSubmissionScope,
} from '@/lib/solanaSubmission';
import {
  isAmbiguousSubmissionError,
  releaseSubmissionDraft,
  reserveSubmissionOperationId,
  submitChainTransactionOnce,
} from '@/lib/submissionIdempotency';

const SOLANA_CLUSTER = 'devnet';
const SOLANA_INTENT_NETWORK = 'solana:devnet';

interface StealthSummary {
  stealthAddress: string;
  ephemeralPubKey: string;
}

interface ReviewedSolanaTransfer {
  intent: TransactionIntent;
  transaction: Transaction;
  blockhash: string;
  lastValidBlockHeight: number;
  draft: string;
  operationId: string;
  stealth: StealthSummary;
}

export function SolanaSend() {
  const { t } = useTranslation();
  const { publicKey, connected, signTransaction } = useWallet();
  const addActivity = useActivityStore((state) => state.addEntry);
  const [recipient, setRecipient] = useSendDraft<string>('solana:recipient', '');
  const [amount, setAmount] = useSendDraft<string>('solana:amount', '');
  const [error, setError] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [stealthResult, setStealthResult] = useState<StealthSummary | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [pendingTransfer, setPendingTransfer] = useState<ReviewedSolanaTransfer | null>(null);

  const connection = useMemo(() => new Connection(SOLANA_NETWORK.rpcUrl, 'confirmed'), []);
  const adapter = useMemo(() => createSolanaSubmissionAdapter(connection), [connection]);
  const account = publicKey?.toBase58() ?? null;
  const scope = useMemo(
    () => (account ? solanaSubmissionScope(SOLANA_CLUSTER, account) : null),
    [account],
  );
  const pending = usePendingChainSubmission(scope, adapter);

  const handleSend = useCallback(async () => {
    if (isPending || pending.blocked) return;
    const blocked = transactionBlockReason();
    if (blocked) {
      setError(blocked);
      return;
    }
    if (!connected || !publicKey || !scope) {
      setError(t('common.walletNotConnected'));
      return;
    }
    if (!recipient.startsWith('st:sol:')) {
      setError(t('solana.validMetaAddressError'));
      return;
    }

    setError('');
    setIsPending(true);
    const finishTransaction = beginTransactionActivity('simulating');

    try {
      const draft = JSON.stringify({
        chain: 'solana',
        network: scope.network,
        wallet: scope.account,
        recipient: recipient.trim(),
        amount: amount.trim(),
      });
      const operationId = await reserveSubmissionOperationId(draft);

      const lamports = BigInt(Math.round(parseFloat(amount) * LAMPORTS_PER_SOL));
      const result = buildSendSol({
        recipientMetaAddress: recipient,
        amount: lamports,
        senderPubkey: publicKey.toBase58(),
      });
      const stealth = {
        stealthAddress: result.stealthAddress,
        ephemeralPubKey: bytesToHex(result.ephemeralPubKey),
      };

      const ix = result.instruction;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const tx = new Transaction({ feePayer: publicKey, blockhash, lastValidBlockHeight }).add(
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

      const intent = buildSolanaSendIntent({
        network: SOLANA_INTENT_NETWORK,
        account: publicKey.toBase58(),
        stealthAddress: result.stealthAddress,
        lamports,
        recentBlockhash: blockhash,
        programId: ix.programId,
        instructionData: Buffer.from(ix.data).toString('hex'),
      });

      setStealthResult(stealth);
      setPendingTransfer({
        intent,
        transaction: tx,
        blockhash,
        lastValidBlockHeight,
        draft,
        operationId,
        stealth,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.transactionFailed'));
    } finally {
      finishTransaction();
      setIsPending(false);
    }
  }, [isPending, pending, connected, publicKey, scope, recipient, amount, connection, t]);

  const handleConfirm = useCallback(async () => {
    if (!publicKey || !pendingTransfer || !scope || isPending || pending.blocked) return;
    if (pendingTransfer.intent.account !== publicKey.toBase58()) {
      setPendingTransfer(null);
      setStealthResult(null);
      setError('The wallet account changed since this transfer was reviewed. Review it again.');
      return;
    }
    if (!signTransaction) {
      setError('This wallet cannot sign transactions. Use a wallet that supports signing.');
      return;
    }
    const blocked = transactionBlockReason();
    if (blocked) {
      setError(blocked);
      return;
    }

    setError('');
    setIsPending(true);
    const finishTransaction = beginTransactionActivity('submitting');
    const { intent, transaction, blockhash, lastValidBlockHeight, draft, operationId, stealth } =
      pendingTransfer;

    try {
      const result = await submitChainTransactionOnce({
        operationId,
        scope,
        adapter,
        prepare: async () => {
          const signed = await signTransaction(transaction);
          const verification = verifySolanaSignedTransaction(transaction, signed);
          if (!verification.ok) {
            throw new Error(
              `Your wallet signed a transaction that does not match the confirmed intent (${verification.mismatches
                .map((mismatch) => mismatch.field)
                .join(', ')}). Nothing was submitted. Review and confirm again.`,
            );
          }
          if (!signed.signature) throw new Error('The wallet did not sign the transaction.');
          const raw = signed.serialize();
          trackEvent('send_submitted');
          return {
            identity: {
              kind: 'solana',
              cluster: SOLANA_CLUSTER,
              from: publicKey.toBase58(),
              signature: bs58.encode(signed.signature),
              blockhash,
              lastValidBlockHeight,
              signedTx: encodeSignedTransaction(raw),
            },
            metadata: { ...stealth },
            broadcast: () =>
              connection.sendRawTransaction(raw, {
                skipPreflight: false,
                preflightCommitment: 'confirmed',
              }),
          };
        },
      });

      setPendingTransfer(null);
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
      setTxHash(result.txHash);
      addActivity({
        id: result.txHash,
        chain: 'solana',
        wallet: scope.account,
        kind: 'stealth-send',
        direction: 'out',
        status: result.status === 'confirmed' ? 'confirmed' : 'pending',
        amount: amount.trim(),
        recipient: recipient.trim(),
        timestamp: Date.now(),
      });
      await releaseSubmissionDraft(draft, operationId);

      if (result.status === 'submitted') {
        const identity = result.record.identity;
        await connection.confirmTransaction(
          {
            signature: result.txHash,
            blockhash: identity?.kind === 'solana' ? identity.blockhash : blockhash,
            lastValidBlockHeight:
              identity?.kind === 'solana' ? identity.lastValidBlockHeight : lastValidBlockHeight,
          },
          'confirmed',
        );
      }
      await pending.check();
      setIsSuccess(true);
      useActivityStore.getState().updateStatus(result.txHash, 'confirmed');
    } catch (err) {
      setPendingTransfer(null);
      if (!isAmbiguousSubmissionError(err) && !txHash) setStealthResult(null);
      setError(err instanceof Error ? err.message : t('common.transactionFailed'));
    } finally {
      finishTransaction();
      setIsPending(false);
      pending.refresh();
    }
  }, [
    publicKey,
    pendingTransfer,
    scope,
    isPending,
    pending,
    signTransaction,
    adapter,
    connection,
    addActivity,
    amount,
    recipient,
    txHash,
    t,
  ]);

  const reset = () => {
    setRecipient('');
    setAmount('');
    setStealthResult(null);
    setPendingTransfer(null);
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

      <PendingSubmissionNotice pending={pending} txUrl={solanaTxUrl} />

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
            disabled={!recipient || !amount || isPending || pending.blocked}
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
                {stealthResult.ephemeralPubKey}
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

          {pendingTransfer && !txHash && (
            <>
              <IntentSummary intent={pendingTransfer.intent} />
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
                  disabled={isPending || pending.blocked}
                  className="h-11 flex-1 bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
                >
                  {isPending ? t('common.confirmInWallet') : 'Confirm & send'}
                </button>
              </div>
            </>
          )}

          {!pendingTransfer && error && <p className="text-sm text-error">{error}</p>}

          {!isSuccess && !txHash && !pendingTransfer && !pending.blocked && error && (
            <button
              onClick={reset}
              className="h-11 w-full border border-outline-variant font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
            >
              Start over
            </button>
          )}

          {(isSuccess || (txHash && !isPending && !pending.blocked)) && (
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
