import { useState, useCallback } from 'react';
import {
  TransactionBuilder,
  Account,
  Operation,
  Asset,
  BASE_FEE,
} from '@stellar/stellar-sdk';
import { generateStealthAddress, decodeStealthMetaAddress } from '@wraith-protocol/sdk/chains/stellar';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { stellarTxUrl, stellarAddrUrl } from '@/lib/explorer';
import { STELLAR_NETWORK } from '@/config';
import { CopyButton } from '@/components/CopyButton';

interface Recipient {
  metaAddress: string;
  weight: string;
}

interface SplitResult {
  stealthAddress: string;
  share: string; // XLM, 7 decimal places
}

const DUST_THRESHOLD = 0.5; // XLM — warn if any share is below this

const defaultRecipients = (): Recipient[] => [
  { metaAddress: '', weight: '1' },
  { metaAddress: '', weight: '1' },
];

export function StellarSplit() {
  const { address, isConnected } = useStellarWallet();
  const { signTransaction } = useStellarWallet();

  const [recipients, setRecipients] = useState<Recipient[]>(defaultRecipients());
  const [totalAmount, setTotalAmount] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<number, string>>({});
  const [isPending, setIsPending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [results, setResults] = useState<SplitResult[] | null>(null);

  // --- helpers ---

  const setRecipient = (idx: number, patch: Partial<Recipient>) =>
    setRecipients((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const addRecipient = () =>
    setRecipients((prev) => [...prev, { metaAddress: '', weight: '1' }]);

  const removeRecipient = (idx: number) =>
    setRecipients((prev) => prev.filter((_, i) => i !== idx));

  /** Compute per-recipient XLM share (string, 7 decimals). Returns null on invalid input. */
  const computeShares = useCallback(
    (recs: Recipient[], amount: string): string[] | null => {
      const total = parseFloat(amount);
      if (!total || total <= 0) return null;
      const weights = recs.map((r) => parseFloat(r.weight));
      if (weights.some((w) => isNaN(w) || w <= 0)) return null;
      const weightSum = weights.reduce((a, b) => a + b, 0);
      return weights.map((w) => ((w / weightSum) * total).toFixed(7));
    },
    [],
  );

  const dustWarning = useCallback(() => {
    const shares = computeShares(recipients, totalAmount);
    if (!shares) return null;
    const dustCount = shares.filter((s) => parseFloat(s) < DUST_THRESHOLD).length;
    return dustCount > 0
      ? `${dustCount} recipient(s) will receive less than ${DUST_THRESHOLD} XLM (dust).`
      : null;
  }, [computeShares, recipients, totalAmount]);

  // --- validation ---

  const validate = (): boolean => {
    const errs: Record<number, string> = {};
    recipients.forEach((r, i) => {
      if (!r.metaAddress.startsWith('st:xlm:'))
        errs[i] = 'Must be a valid Stellar meta-address (st:xlm:...)';
      const w = parseFloat(r.weight);
      if (isNaN(w) || w <= 0) errs[i] = (errs[i] ? errs[i] + ' ' : '') + 'Weight must be > 0';
    });
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return false;

    const amt = parseFloat(totalAmount);
    if (!amt || amt <= 0) {
      setError('Enter a valid total amount');
      return false;
    }
    return true;
  };

  // --- submit ---

  const handleSplit = useCallback(async () => {
    if (!address) { setError('Wallet not connected'); return; }
    setError('');
    if (!validate()) return;

    setIsPending(true);
    try {
      const shares = computeShares(recipients, totalAmount)!;
      const horizonUrl = STELLAR_NETWORK.horizonUrl;
      const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

      // Resolve stealth addresses
      const stealthAddresses = recipients.map((r, i) => {
        const decoded = decodeStealthMetaAddress(r.metaAddress);
        const { stealthAddress } = generateStealthAddress(
          decoded.spendingPubKey,
          decoded.viewingPubKey,
        );
        return { stealthAddress, share: shares[i] };
      });

      // Load sender account
      const accountRes = await fetch(`${horizonUrl}/accounts/${address}`);
      if (!accountRes.ok) throw new Error('Failed to load sender account');
      const accountData = await accountRes.json();
      const sourceAccount = new Account(address, accountData.sequence);

      // Check which stealth addresses already exist
      const existsFlags = await Promise.all(
        stealthAddresses.map(({ stealthAddress }) =>
          fetch(`${horizonUrl}/accounts/${stealthAddress}`).then((r) => r.ok),
        ),
      );

      // Build a single transaction with one operation per recipient
      const builder = new TransactionBuilder(sourceAccount, {
        fee: String(Number(BASE_FEE) * stealthAddresses.length),
        networkPassphrase,
      }).setTimeout(30);

      stealthAddresses.forEach(({ stealthAddress, share }, i) => {
        if (existsFlags[i]) {
          builder.addOperation(
            Operation.payment({ destination: stealthAddress, asset: Asset.native(), amount: share }),
          );
        } else {
          builder.addOperation(
            Operation.createAccount({ destination: stealthAddress, startingBalance: share }),
          );
        }
      });

      const tx = builder.build();
      const signedXdr = await signTransaction(tx.toXDR());

      const submitRes = await fetch(`${horizonUrl}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `tx=${encodeURIComponent(signedXdr)}`,
      });
      const submitData = await submitRes.json();
      if (!submitRes.ok) {
        throw new Error(
          submitData.extras?.result_codes?.transaction || submitData.title || 'Transaction failed',
        );
      }

      setTxHash(submitData.hash);
      setResults(stealthAddresses);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setIsPending(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, recipients, totalAmount, signTransaction, computeShares]);

  const reset = () => {
    setRecipients(defaultRecipients());
    setTotalAmount('');
    setError('');
    setFieldErrors({});
    setTxHash(null);
    setResults(null);
  };

  // --- render: not connected ---
  if (!isConnected) {
    return (
      <section className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Stellar Testnet / XLM
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Split
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Connect your Freighter wallet to split a payment among multiple recipients.
        </p>
      </section>
    );
  }

  const shares = computeShares(recipients, totalAmount);
  const dust = dustWarning();
  const weightSum = recipients.reduce((s, r) => s + (parseFloat(r.weight) || 0), 0);

  // --- render: success ---
  if (results) {
    return (
      <section className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Stellar Testnet / XLM
          </span>
          <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
            Split
          </h1>
        </div>

        <div className="flex flex-col gap-5 border border-outline-variant bg-surface-container p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
            <span className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface">
              Split Complete
            </span>
          </div>

          {txHash && (
            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Transaction
              </span>
              <div className="mt-0.5 flex items-center gap-2">
                <a
                  href={stellarTxUrl(txHash)}
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

          <div className="flex flex-col gap-3">
            {results.map((r, i) => (
              <div key={i} className="border-t border-outline-variant/30 pt-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                    Recipient {i + 1}
                  </span>
                  <span className="font-mono text-xs text-on-surface-variant">{r.share} XLM</span>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <a
                    href={stellarAddrUrl(r.stealthAddress)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate font-mono text-xs text-primary underline"
                  >
                    {r.stealthAddress}
                  </a>
                  <CopyButton text={r.stealthAddress} />
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={reset}
            className="h-11 w-full border border-outline-variant font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
          >
            New Split
          </button>
        </div>
      </section>
    );
  }

  // --- render: form ---
  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Stellar Testnet / XLM
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Split
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Split a payment atomically among multiple recipients using stealth addresses.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {/* Total amount */}
        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Total Amount
          </label>
          <div className="relative">
            <input
              type="text"
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              placeholder="0.0"
              className="h-12 w-full border border-outline-variant bg-surface px-4 pr-16 font-heading text-2xl text-primary placeholder:text-outline focus:border-primary"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-outline">
              XLM
            </span>
          </div>
        </div>

        {/* Recipients */}
        <div className="flex flex-col gap-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Recipients
          </span>

          {recipients.map((r, i) => (
            <div
              key={i}
              className="flex flex-col gap-2 border border-outline-variant/40 p-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                  #{i + 1}
                </span>
                <div className="flex items-center gap-3">
                  {shares && (
                    <span className="font-mono text-[10px] text-on-surface-variant">
                      {shares[i]} XLM
                      {weightSum > 0 && (
                        <span className="ml-1 text-outline">
                          ({((parseFloat(r.weight) / weightSum) * 100).toFixed(1)}%)
                        </span>
                      )}
                    </span>
                  )}
                  {recipients.length > 2 && (
                    <button
                      onClick={() => removeRecipient(i)}
                      className="font-heading text-[10px] uppercase tracking-widest text-outline hover:text-error"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <input
                type="text"
                value={r.metaAddress}
                onChange={(e) => setRecipient(i, { metaAddress: e.target.value })}
                placeholder="st:xlm:..."
                className="h-10 w-full border border-outline-variant bg-surface px-3 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
              />

              <div className="flex items-center gap-2">
                <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
                  Weight
                </label>
                <input
                  type="number"
                  value={r.weight}
                  min="0.01"
                  step="0.01"
                  onChange={(e) => setRecipient(i, { weight: e.target.value })}
                  className="h-8 w-24 border border-outline-variant bg-surface px-2 font-mono text-sm text-primary focus:border-primary"
                />
              </div>

              {fieldErrors[i] && (
                <p className="font-mono text-[10px] text-error">{fieldErrors[i]}</p>
              )}
            </div>
          ))}

          <button
            onClick={addRecipient}
            className="h-9 w-full border border-dashed border-outline-variant font-heading text-[10px] uppercase tracking-widest text-outline hover:text-on-surface-variant"
          >
            + Add Recipient
          </button>
        </div>

        {/* Fee info */}
        <div className="flex flex-col gap-2 border-t border-outline-variant/30 pt-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Network fee
            </span>
            <span className="font-mono text-[10px] text-on-surface-variant">
              {recipients.length * 100} stroops
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Operations
            </span>
            <span className="font-mono text-[10px] text-on-surface-variant">
              {recipients.length} (atomic)
            </span>
          </div>
        </div>

        {dust && (
          <p className="font-mono text-[10px] text-on-surface-variant">⚠ {dust}</p>
        )}

        {error && <p className="text-sm text-error">{error}</p>}

        <button
          onClick={handleSplit}
          disabled={isPending}
          className="h-12 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
        >
          {isPending ? 'Confirm in wallet...' : `Split Among ${recipients.length} Recipients`}
        </button>
      </div>
    </section>
  );
}
