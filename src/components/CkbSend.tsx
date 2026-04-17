import { useState, useCallback } from 'react';
import { generateStealthAddress, decodeStealthMetaAddress, bytesToHex } from '@/lib/ckb-stealth';

export function CkbSend() {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [stealthResult, setStealthResult] = useState<{
    stealthAddress: string;
    lockArgs: string;
    ephemeralPubKey: Uint8Array;
    viewTag: number;
  } | null>(null);

  const handleGenerate = useCallback(() => {
    setError('');

    try {
      if (!recipient.startsWith('st:ckb:')) {
        setError('Enter a valid CKB meta-address (st:ckb:...)');
        return;
      }

      const decoded = decodeStealthMetaAddress(recipient);
      const result = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
      setStealthResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    }
  }, [recipient]);

  const reset = () => {
    setRecipient('');
    setAmount('');
    setStealthResult(null);
    setError('');
  };

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="mb-1 font-heading text-3xl font-bold uppercase tracking-tight text-primary">
          Send
        </h1>
        <p className="text-sm text-on-surface-variant">
          Generate a stealth Cell for CKB Testnet. The Cell itself serves as the announcement
          &mdash; no separate announcer contract needed.
        </p>
      </div>

      {!stealthResult && (
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
              Amount (CKB)
            </label>
            <input
              type="text"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.0"
              className="w-full border border-outline-variant bg-surface-container px-4 py-3 font-heading text-2xl text-primary placeholder:text-outline focus:border-primary"
            />
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          <button
            onClick={handleGenerate}
            disabled={!recipient || !amount}
            className="w-full bg-primary py-4 font-heading text-sm font-bold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            Generate Stealth Cell
          </button>
        </div>
      )}

      {stealthResult && (
        <div className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-6">
          <div className="flex items-center gap-2">
            <span className="text-sm text-primary">[+]</span>
            <span className="font-heading text-xs uppercase text-primary">
              Stealth Cell Generated
            </span>
          </div>

          <div className="space-y-3">
            <div>
              <span className="font-heading text-[10px] uppercase tracking-widest text-outline">
                Stealth Address (Pub Key)
              </span>
              <p className="truncate font-mono text-xs text-primary">
                {stealthResult.stealthAddress}
              </p>
            </div>

            <div>
              <span className="font-heading text-[10px] uppercase tracking-widest text-outline">
                Lock Args
              </span>
              <p className="break-all font-mono text-[11px] text-on-surface-variant">
                {stealthResult.lockArgs}
              </p>
            </div>

            <div>
              <span className="font-heading text-[10px] uppercase tracking-widest text-outline">
                Ephemeral Pub Key
              </span>
              <p className="truncate font-mono text-xs text-on-surface-variant">
                {bytesToHex(stealthResult.ephemeralPubKey)}
              </p>
            </div>

            <div>
              <span className="font-heading text-[10px] uppercase tracking-widest text-outline">
                View Tag
              </span>
              <p className="font-mono text-xs text-on-surface-variant">{stealthResult.viewTag}</p>
            </div>

            <div className="border border-outline-variant bg-surface p-4">
              <p className="mb-2 font-heading text-[10px] uppercase tracking-widest text-outline">
                Next Steps
              </p>
              <p className="text-xs text-on-surface-variant">
                Create a Cell with {amount} CKB capacity using the lock args above. The lock script
                should encode the stealth public key so the recipient can scan and claim.
              </p>
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
