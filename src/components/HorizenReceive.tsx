import { useState, useCallback } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  deriveStealthKeys,
  encodeStealthMetaAddress,
  fetchAnnouncements,
  scanAnnouncements,
  STEALTH_SIGNING_MESSAGE,
} from '@wraith-protocol/sdk/chains/evm';
import type { HexString, StealthKeys, MatchedAnnouncement } from '@wraith-protocol/sdk/chains/evm';
import { horizenTestnet } from '@/config';

function explorerTxUrl(hash: string) {
  return `${horizenTestnet.blockExplorers.default.url}/tx/${hash}`;
}

function explorerAddrUrl(addr: string) {
  return `${horizenTestnet.blockExplorers.default.url}/address/${addr}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="font-heading text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function StealthRow({
  match,
  onWithdrawn,
}: {
  match: MatchedAnnouncement;
  onWithdrawn: (hash: string) => void;
}) {
  const [balance, setBalance] = useState<string | null>(null);
  const [loadingBal, setLoadingBal] = useState(false);
  const [dest, setDest] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawHash, setWithdrawHash] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showKey, setShowKey] = useState(false);

  const fetchBalance = useCallback(async () => {
    setLoadingBal(true);
    try {
      const client = createPublicClient({ chain: horizenTestnet, transport: http() });
      const bal = await client.getBalance({ address: match.stealthAddress as `0x${string}` });
      const eth = Number(bal) / 1e18;
      setBalance(eth.toFixed(6));
    } catch {
      setBalance('0');
    } finally {
      setLoadingBal(false);
    }
  }, [match.stealthAddress]);

  useState(() => {
    fetchBalance();
  });

  const handleWithdraw = async () => {
    if (!dest) return;
    setError('');
    setWithdrawing(true);
    try {
      const account = privateKeyToAccount(match.stealthPrivateKey as `0x${string}`);
      const publicClient = createPublicClient({ chain: horizenTestnet, transport: http() });
      const walletClient = createWalletClient({
        account,
        chain: horizenTestnet,
        transport: http(),
      });

      const bal = await publicClient.getBalance({ address: account.address });
      if (bal === 0n) throw new Error('No balance');

      const gasEstimate = await publicClient.estimateGas({
        account,
        to: dest as `0x${string}`,
        value: 1n,
      });
      const gasPrice = await publicClient.getGasPrice();
      const gasCost = (gasEstimate * gasPrice * 150n) / 100n;
      const sendAmount = bal - gasCost;

      if (sendAmount <= 0n) throw new Error('Balance too low to cover gas');

      const hash = await walletClient.sendTransaction({
        to: dest as `0x${string}`,
        value: sendAmount,
        gas: gasEstimate,
      });

      setWithdrawHash(hash);
      onWithdrawn(hash);
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
            href={explorerAddrUrl(match.stealthAddress)}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate font-mono text-xs text-primary underline"
          >
            {match.stealthAddress}
          </a>
        </div>
        <span className="font-heading text-lg font-bold text-on-surface">
          {loadingBal ? '...' : balance ? `${balance} ETH` : 'Empty'}
        </span>
      </div>

      {!withdrawHash && balance && parseFloat(balance) > 0 && (
        <div className="flex gap-2">
          <input
            type="text"
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            placeholder="Destination address (0x...)"
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
              href={explorerTxUrl(withdrawHash)}
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
            Reveal private key
          </button>
        ) : (
          <div className="border border-error/20 bg-error/5 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-heading text-[9px] font-bold uppercase tracking-widest text-error">
                Stealth Key
              </span>
              <CopyButton text={match.stealthPrivateKey} />
            </div>
            <code className="break-all font-mono text-[11px] text-on-surface">
              {match.stealthPrivateKey}
            </code>
          </div>
        )}
      </div>
    </div>
  );
}

export function HorizenReceive() {
  const { isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [keys, setKeys] = useState<StealthKeys | null>(null);
  const [metaAddress, setMetaAddress] = useState('');
  const [isDerivingKeys, setIsDerivingKeys] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [matched, setMatched] = useState<MatchedAnnouncement[]>([]);
  const [hasScanned, setHasScanned] = useState(false);
  const [error, setError] = useState('');

  const deriveKeys = async () => {
    setIsDerivingKeys(true);
    setError('');
    try {
      const signature = await signMessageAsync({ message: STEALTH_SIGNING_MESSAGE });
      const derived = deriveStealthKeys(signature as HexString);
      setKeys(derived);
      const meta = encodeStealthMetaAddress(derived.spendingPubKey, derived.viewingPubKey);
      setMetaAddress(meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Key derivation failed');
    } finally {
      setIsDerivingKeys(false);
    }
  };

  const scanPayments = async () => {
    if (!keys) return;
    setIsScanning(true);
    setError('');
    try {
      const announcements = await fetchAnnouncements('horizen');
      const results = scanAnnouncements(
        announcements,
        keys.viewingKey,
        keys.spendingPubKey,
        keys.spendingKey,
      );
      setMatched(results);
      setHasScanned(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setIsScanning(false);
    }
  };

  if (!isConnected) {
    return (
      <section>
        <h1 className="mb-2 font-heading text-3xl font-bold uppercase tracking-tight text-primary">
          Receive
        </h1>
        <p className="text-sm text-on-surface-variant">
          Connect your wallet to scan for incoming stealth transfers on Horizen.
        </p>
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
          Derive your stealth keys, then scan for incoming payments.
        </p>
      </div>

      {!keys && (
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

      {keys && (
        <>
          <div className="border border-outline-variant bg-surface-container p-5">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-heading text-[10px] uppercase tracking-widest text-outline">
                Your Stealth Meta-Address
              </span>
              <CopyButton text={metaAddress} />
            </div>
            <code className="break-all font-mono text-xs text-primary">{metaAddress}</code>
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
                <StealthRow key={i} match={m} onWithdrawn={() => {}} />
              ))}
            </div>
          )}

          {hasScanned && matched.length === 0 && (
            <div className="py-12 text-center opacity-50">
              <p className="font-heading text-sm uppercase">No transfers found</p>
              <p className="mt-1 text-xs text-on-surface-variant">
                No stealth transfers matched your keys.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
