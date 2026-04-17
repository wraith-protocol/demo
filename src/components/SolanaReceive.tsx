import { useState, useEffect, useCallback } from 'react';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  deriveStealthKeys,
  encodeStealthMetaAddress,
  scanAnnouncements,
  signSolanaTransaction,
  STEALTH_SIGNING_MESSAGE,
} from '@wraith-protocol/sdk/chains/solana';
import type { Announcement, MatchedAnnouncement } from '@wraith-protocol/sdk/chains/solana';
import { useStealthKeys } from '@/context/StealthKeysContext';
import { CopyButton } from '@/components/CopyButton';
import { solanaTxUrl, solanaAddrUrl } from '@/lib/explorer';
import { SOLANA_NETWORK } from '@/config';

function SolanaStealthRow({
  match,
  onWithdrawn,
}: {
  match: MatchedAnnouncement;
  onWithdrawn: () => void;
}) {
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
      onWithdrawn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Withdraw failed');
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-5">
      <div className="flex items-start justify-between">
        <div>
          <span className="font-heading text-[10px] uppercase tracking-widest text-outline">
            Stealth Address
          </span>
          <a
            href={solanaAddrUrl(match.stealthAddress)}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate font-mono text-xs text-primary underline"
          >
            {match.stealthAddress}
          </a>
        </div>
        <span className="font-heading text-lg font-bold text-on-surface">
          {loadingBal ? '...' : balance && parseFloat(balance) > 0 ? `${balance} SOL` : 'Empty'}
        </span>
      </div>

      {!withdrawHash && balance && parseFloat(balance) > 0 && (
        <div className="flex gap-2">
          <input
            type="text"
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            placeholder="Destination address (base58)"
            className="flex-1 border border-outline-variant bg-surface px-3 py-2 font-mono text-xs text-primary placeholder:text-outline focus:border-primary"
          />
          <button
            onClick={handleWithdraw}
            disabled={!dest || withdrawing}
            className="bg-primary px-4 py-2 font-heading text-[10px] font-bold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {withdrawing ? '...' : 'Withdraw'}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-error">{error}</p>}

      {withdrawHash && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-primary">[+]</span>
          <span className="text-[10px] text-on-surface-variant">
            Withdrawn —{' '}
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

      <div>
        {!showKey ? (
          <button
            onClick={() => setShowKey(true)}
            className="font-heading text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
          >
            Reveal secret key
          </button>
        ) : (
          <div className="border border-error/20 bg-error/5 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-heading text-[9px] font-bold uppercase tracking-widest text-error">
                Stealth Key
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
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const { solanaKeys, solanaMetaAddress, setSolanaKeys, setSolanaMetaAddress } = useStealthKeys();

  const [isDerivingKeys, setIsDerivingKeys] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [matched, setMatched] = useState<MatchedAnnouncement[]>([]);
  const [hasScanned, setHasScanned] = useState(false);
  const [error, setError] = useState('');

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

  const deriveKeys = useCallback(async () => {
    setIsDerivingKeys(true);
    setError('');
    try {
      const phantom = (window as unknown as Record<string, unknown>).solana as {
        signMessage: (message: Uint8Array, encoding: string) => Promise<{ signature: Uint8Array }>;
      };
      const msgBytes = new TextEncoder().encode(STEALTH_SIGNING_MESSAGE);
      const { signature } = await phantom.signMessage(msgBytes, 'utf8');
      const derived = deriveStealthKeys(signature);
      setSolanaKeys(derived);
      const meta = encodeStealthMetaAddress(derived.spendingPubKey, derived.viewingPubKey);
      setSolanaMetaAddress(meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Key derivation failed');
    } finally {
      setIsDerivingKeys(false);
    }
  }, [setSolanaKeys, setSolanaMetaAddress]);

  const scanPayments = useCallback(async () => {
    if (!solanaKeys) return;
    setIsScanning(true);
    setError('');
    try {
      const announcements: Announcement[] = [];

      const results = scanAnnouncements(
        announcements,
        solanaKeys.viewingKey,
        solanaKeys.spendingPubKey,
        solanaKeys.spendingScalar,
      );
      setMatched(results);
      setHasScanned(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setIsScanning(false);
    }
  }, [solanaKeys]);

  if (!isConnected) {
    return (
      <section>
        <h1 className="mb-2 font-heading text-3xl font-bold uppercase tracking-tight text-primary">
          Receive
        </h1>
        <p className="mb-4 text-sm text-on-surface-variant">
          Connect your Phantom wallet to scan for incoming stealth transfers on Solana.
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
          Receive
        </h1>
        <p className="text-sm text-on-surface-variant">
          Derive your stealth keys, then scan for payments on Solana Devnet.
        </p>
      </div>

      {!solanaKeys && (
        <div className="flex flex-col gap-4">
          <button
            onClick={deriveKeys}
            disabled={isDerivingKeys}
            className="w-full bg-primary py-4 font-heading text-sm font-bold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {isDerivingKeys ? 'Sign in wallet...' : 'Derive Keys'}
          </button>
          {error && <p className="text-sm text-error">{error}</p>}
        </div>
      )}

      {solanaKeys && solanaMetaAddress && (
        <>
          <div className="border border-outline-variant bg-surface-container p-5">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-heading text-[10px] uppercase tracking-widest text-outline">
                Your Stealth Meta-Address
              </span>
              <CopyButton text={solanaMetaAddress} />
            </div>
            <code className="break-all font-mono text-xs text-primary">{solanaMetaAddress}</code>
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={scanPayments}
              disabled={isScanning}
              className="bg-primary px-6 py-3 font-heading text-sm font-bold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
            >
              {isScanning ? 'Scanning...' : 'Scan for Payments'}
            </button>
            {hasScanned && (
              <span className="font-heading text-xs text-on-surface-variant">
                {matched.length} transfer{matched.length !== 1 ? 's' : ''} found
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
            <div className="py-12 text-center opacity-50">
              <p className="font-heading text-sm uppercase">No transfers found</p>
              <p className="mt-1 text-xs text-on-surface-variant">
                No stealth transfers matched your keys. Solana announcer program coming soon.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
