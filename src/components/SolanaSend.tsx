import { useState, useCallback } from 'react';
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { generateStealthAddress, decodeStealthMetaAddress, bytesToHex } from '@/lib/solana-stealth';
import { solanaTxUrl, solanaAddrUrl } from '@/lib/explorer';
import { SOLANA_NETWORK } from '@/config';

export function SolanaSend() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
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

  const isConnected = !!walletAddress;

  const connectWallet = useCallback(async () => {
    try {
      const phantom = (window as unknown as Record<string, unknown>).solana as
        | {
            isPhantom?: boolean;
            connect: () => Promise<{ publicKey: { toString: () => string } }>;
          }
        | undefined;
      if (!phantom?.isPhantom) {
        setError('Phantom wallet not found. Please install the Phantom browser extension.');
        return;
      }
      const resp = await phantom.connect();
      setWalletAddress(resp.publicKey.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect wallet');
    }
  }, []);

  const handleSend = useCallback(async () => {
    if (!walletAddress) {
      setError('Wallet not connected');
      return;
    }

    setError('');
    setIsPending(true);

    try {
      if (!recipient.startsWith('st:sol:')) {
        setError('Enter a valid Solana meta-address (st:sol:...)');
        setIsPending(false);
        return;
      }

      const decoded = decodeStealthMetaAddress(recipient);
      const result = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
      setStealthResult(result);

      const connection = new Connection(SOLANA_NETWORK.rpcUrl, 'confirmed');

      const stealthPubkey = new PublicKey(result.stealthAddress);
      const senderPubkey = new PublicKey(walletAddress);

      const lamports = Math.round(parseFloat(amount) * LAMPORTS_PER_SOL);

      const tx = new Transaction();
      tx.add(
        SystemProgram.transfer({
          fromPubkey: senderPubkey,
          toPubkey: stealthPubkey,
          lamports,
        }),
      );

      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = senderPubkey;

      const phantom = (window as unknown as Record<string, unknown>).solana as {
        signAndSendTransaction: (tx: Transaction) => Promise<{ signature: string }>;
      };

      const { signature } = await phantom.signAndSendTransaction(tx);
      setTxHash(signature);

      await connection.confirmTransaction(signature, 'confirmed');
      setIsSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setIsPending(false);
    }
  }, [walletAddress, recipient, amount]);

  const reset = () => {
    setRecipient('');
    setAmount('');
    setStealthResult(null);
    setTxHash(null);
    setIsSuccess(false);
    setError('');
  };

  if (!isConnected) {
    return (
      <section>
        <h1 className="mb-2 font-heading text-3xl font-bold uppercase tracking-tight text-primary">
          Send
        </h1>
        <p className="mb-4 text-sm text-on-surface-variant">
          Connect your Phantom wallet to send stealth payments on Solana.
        </p>
        <button
          onClick={connectWallet}
          className="bg-primary px-6 py-3 font-heading text-sm font-bold uppercase tracking-widest text-surface transition-colors hover:brightness-110"
        >
          Connect Phantom
        </button>
        {error && <p className="mt-2 text-sm text-error">{error}</p>}
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
          Send SOL to a stealth address on Solana Devnet.
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
              placeholder="st:sol:..."
              className="w-full border border-outline-variant bg-surface-container px-4 py-3 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
            />
          </div>

          <div className="space-y-2">
            <label className="font-heading text-[10px] uppercase tracking-widest text-outline">
              Amount (SOL)
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
            onClick={handleSend}
            disabled={!recipient || !amount || isPending}
            className="w-full bg-primary py-4 font-heading text-sm font-bold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {isPending ? 'Confirm in wallet...' : 'Send'}
          </button>
        </div>
      )}

      {stealthResult && (
        <div className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-6">
          <div className="flex items-center gap-2">
            <span className="text-sm text-primary">{isSuccess ? '[+]' : '[~]'}</span>
            <span className="font-heading text-xs uppercase text-primary">
              {isSuccess ? 'Transfer Complete' : 'Pending'}
            </span>
          </div>

          <div className="space-y-2">
            <div>
              <span className="font-heading text-[10px] uppercase tracking-widest text-outline">
                Stealth Address
              </span>
              <a
                href={solanaAddrUrl(stealthResult.stealthAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate font-mono text-xs text-primary underline"
              >
                {stealthResult.stealthAddress}
              </a>
            </div>

            <div>
              <span className="font-heading text-[10px] uppercase tracking-widest text-outline">
                Ephemeral Pub Key
              </span>
              <p className="truncate font-mono text-xs text-on-surface-variant">
                {bytesToHex(stealthResult.ephemeralPubKey)}
              </p>
            </div>

            {txHash && (
              <div>
                <span className="font-heading text-[10px] uppercase tracking-widest text-outline">
                  Transaction
                </span>
                <a
                  href={solanaTxUrl(txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate font-mono text-xs text-primary underline"
                >
                  {txHash}
                </a>
              </div>
            )}
          </div>

          {isSuccess && (
            <button
              onClick={reset}
              className="w-full border border-outline-variant py-3 font-heading text-sm font-bold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
            >
              New Transfer
            </button>
          )}
        </div>
      )}
    </section>
  );
}
