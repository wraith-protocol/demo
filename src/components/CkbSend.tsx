import { useState, useCallback } from 'react';
import { ccc } from '@ckb-ccc/connector-react';
import {
  generateStealthAddress,
  decodeStealthMetaAddress,
  getDeployment,
} from '@wraith-protocol/sdk/chains/ckb';

const STEALTH_LOCK_CODE_HASH = getDeployment('ckb').contracts.stealthLockCodeHash;

export function CkbSend() {
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
      setError('Connect your CKB wallet first');
      return;
    }

    setError('');
    setIsPending(true);

    try {
      if (!recipient.startsWith('st:ckb:')) {
        setError('Enter a valid CKB meta-address (st:ckb:...)');
        setIsPending(false);
        return;
      }

      const parsed = parseFloat(amount);
      if (parsed < 95) {
        setError(
          'Minimum amount is 95 CKB. Stealth cells require at least ~94.5 CKB for cell capacity.',
        );
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
      setTxHash(hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setIsPending(false);
    }
  }, [signer, recipient, amount]);

  const reset = () => {
    setRecipient('');
    setAmount('');
    setStealthInfo(null);
    setTxHash(null);
    setError('');
  };

  const deployment = getDeployment('ckb');

  if (!wallet) {
    return (
      <section>
        <h1 className="mb-2 font-heading text-3xl font-bold uppercase tracking-tight text-primary">
          Send
        </h1>
        <p className="mb-4 text-sm text-on-surface-variant">
          Connect your CKB wallet using the button in the header to send stealth payments.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="mb-1 font-heading text-3xl font-bold uppercase tracking-tight text-primary">
          Send
        </h1>
        <p className="text-sm text-on-surface-variant">
          Send CKB to a stealth address on CKB Testnet.
        </p>
      </div>

      {!txHash && (
        <div className="flex flex-col gap-6">
          <div className="space-y-2">
            <label className="font-heading text-[10px] uppercase tracking-widest text-outline">
              Recipient
            </label>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="st:ckb:..."
              className="w-full border border-outline-variant bg-surface-container px-4 py-3 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
            />
          </div>

          <div className="space-y-2">
            <label className="font-heading text-[10px] uppercase tracking-widest text-outline">
              Amount (CKB, min 95)
            </label>
            <input
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="95"
              className="w-full border border-outline-variant bg-surface-container px-4 py-3 font-heading text-2xl text-primary placeholder:text-outline focus:border-primary"
            />
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          <button
            onClick={handleSend}
            disabled={!recipient || !amount || isPending}
            className="w-full bg-primary py-4 font-heading text-sm font-bold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {isPending ? 'Confirm in wallet...' : 'Send'}
          </button>
        </div>
      )}

      {txHash && stealthInfo && (
        <div className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-6">
          <div className="flex items-center gap-2">
            <span className="text-sm text-primary">[+]</span>
            <span className="font-heading text-xs uppercase text-primary">Transfer Complete</span>
          </div>

          <div className="space-y-2">
            <div>
              <span className="font-heading text-[10px] uppercase tracking-widest text-outline">
                Stealth Public Key
              </span>
              <p className="truncate font-mono text-xs text-primary">{stealthInfo.stealthPubKey}</p>
            </div>

            <div>
              <span className="font-heading text-[10px] uppercase tracking-widest text-outline">
                Transaction
              </span>
              <a
                href={`${deployment.explorerUrl}/transaction/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate font-mono text-xs text-primary underline"
              >
                {txHash}
              </a>
            </div>
          </div>

          <button
            onClick={reset}
            className="w-full border border-outline-variant py-3 font-heading text-sm font-bold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
          >
            New Transfer
          </button>
        </div>
      )}
    </section>
  );
}
