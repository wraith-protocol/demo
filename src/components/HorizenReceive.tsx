import { useState, useEffect } from 'react';
import {
  useAccount,
  useSignMessage,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
} from 'wagmi';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  deriveStealthKeys,
  encodeStealthMetaAddress,
  fetchAnnouncements,
  scanAnnouncements,
  STEALTH_SIGNING_MESSAGE,
  SCHEME_ID,
  metaAddressToBytes,
  REGISTRY_ABI,
  getDeployment,
} from '@wraith-protocol/sdk/chains/evm';
import type { HexString, MatchedAnnouncement } from '@wraith-protocol/sdk/chains/evm';
import { useStealthKeys } from '@/context/StealthKeysContext';
import { CopyButton } from '@/components/CopyButton';
import { horizenTxUrl, horizenAddrUrl } from '@/lib/explorer';
import { horizenTestnet } from '@/config';

function StealthRow({
  match,
  onWithdrawn,
}: {
  match: MatchedAnnouncement;
  onWithdrawn: (hash: string) => void;
}) {
  const [balance, setBalance] = useState<string | null>(null);
  const [loadingBal, setLoadingBal] = useState(true);
  const [dest, setDest] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawHash, setWithdrawHash] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const client = createPublicClient({ chain: horizenTestnet, transport: http() });
        const bal = await client.getBalance({ address: match.stealthAddress as `0x${string}` });
        setBalance((Number(bal) / 1e18).toFixed(6));
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
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Stealth Address
          </span>
          <div className="mt-0.5 flex items-center gap-2">
            <a
              href={horizenAddrUrl(match.stealthAddress)}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate font-mono text-xs text-primary underline"
            >
              {match.stealthAddress}
            </a>
            <CopyButton text={match.stealthAddress} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {loadingBal ? (
            <span className="font-mono text-xs text-outline">...</span>
          ) : balance && parseFloat(balance) > 0 ? (
            <>
              <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
              <span className="font-heading text-lg font-bold text-on-surface">{balance} ETH</span>
            </>
          ) : (
            <span className="font-mono text-xs text-outline">Empty</span>
          )}
        </div>
      </div>

      {!withdrawHash && balance && parseFloat(balance) > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Withdraw to
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              placeholder="Destination address (0x...)"
              className="h-10 flex-1 border border-outline-variant bg-surface px-3 font-mono text-xs text-primary placeholder:text-outline focus:border-primary"
            />
            <button
              onClick={handleWithdraw}
              disabled={!dest || withdrawing}
              className="h-10 bg-primary px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
            >
              {withdrawing ? '...' : 'Withdraw'}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-error">{error}</p>}

      {withdrawHash && (
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
          <span className="font-mono text-[10px] text-on-surface-variant">
            Withdrawn —{' '}
            <a
              href={horizenTxUrl(withdrawHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              {withdrawHash.slice(0, 14)}...
            </a>
          </span>
        </div>
      )}

      <div className="border-t border-outline-variant/30 pt-3">
        {!showKey ? (
          <button
            onClick={() => setShowKey(true)}
            className="font-mono text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
          >
            Reveal private key
          </button>
        ) : (
          <div className="border border-error/20 bg-error/5 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-[9px] font-semibold uppercase tracking-widest text-error">
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
  const { isConnected, address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { evmKeys, evmMetaAddress, setEvmKeys, setEvmMetaAddress } = useStealthKeys();

  const [isDerivingKeys, setIsDerivingKeys] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [matched, setMatched] = useState<MatchedAnnouncement[]>([]);
  const [hasScanned, setHasScanned] = useState(false);
  const [error, setError] = useState('');

  const deployment = getDeployment('horizen');

  // Check if already registered on-chain
  const { data: registeredMeta, refetch: refetchRegistration } = useReadContract({
    address: deployment.contracts.registry as `0x${string}`,
    abi: REGISTRY_ABI,
    functionName: 'stealthMetaAddressOf',
    args: address ? [address, SCHEME_ID] : undefined,
    query: { enabled: !!address },
  });

  const isAlreadyRegistered =
    !!registeredMeta && registeredMeta !== '0x' && (registeredMeta as string).length > 2;

  // Registration tx
  const { writeContract, data: regHash, isPending: isRegPending } = useWriteContract();
  const { isLoading: isRegConfirming, isSuccess: isRegSuccess } = useWaitForTransactionReceipt({
    hash: regHash,
  });

  // Refetch registration status after successful registration
  useEffect(() => {
    if (isRegSuccess) {
      refetchRegistration();
    }
  }, [isRegSuccess, refetchRegistration]);

  const registered = isAlreadyRegistered || isRegSuccess;

  const deriveKeys = async () => {
    setIsDerivingKeys(true);
    setError('');
    try {
      const signature = await signMessageAsync({ message: STEALTH_SIGNING_MESSAGE });
      const derived = deriveStealthKeys(signature as HexString);
      setEvmKeys(derived);
      const meta = encodeStealthMetaAddress(derived.spendingPubKey, derived.viewingPubKey);
      setEvmMetaAddress(meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Key derivation failed');
    } finally {
      setIsDerivingKeys(false);
    }
  };

  const registerOnChain = () => {
    if (!evmMetaAddress) return;
    const metaBytes = metaAddressToBytes(evmMetaAddress);
    writeContract({
      address: deployment.contracts.registry as `0x${string}`,
      abi: REGISTRY_ABI,
      functionName: 'registerKeys',
      args: [SCHEME_ID, metaBytes as `0x${string}`],
    });
  };

  const scanPayments = async () => {
    if (!evmKeys) return;
    setIsScanning(true);
    setError('');
    try {
      const announcements = await fetchAnnouncements('horizen');
      const results = scanAnnouncements(
        announcements,
        evmKeys.viewingKey,
        evmKeys.spendingPubKey,
        evmKeys.spendingKey,
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
      <section className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Horizen Testnet / ETH
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Receive
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Connect your wallet to scan for incoming stealth transfers on Horizen.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Horizen Testnet / ETH
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Receive
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Derive your stealth keys, register on-chain, then scan for payments.
        </p>
      </div>

      {!evmKeys && (
        <div className="flex flex-col gap-4">
          <button
            onClick={deriveKeys}
            disabled={isDerivingKeys}
            className="h-12 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {isDerivingKeys ? 'Sign in wallet...' : 'Derive Keys'}
          </button>
          {error && <p className="text-sm text-error">{error}</p>}
        </div>
      )}

      {evmKeys && evmMetaAddress && (
        <>
          <div className="border border-outline-variant bg-surface-container p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Your Stealth Meta-Address
              </span>
              <CopyButton text={evmMetaAddress} />
            </div>
            <code className="block break-all font-mono text-xs leading-relaxed text-primary">
              {evmMetaAddress}
            </code>
          </div>

          <div className="border border-outline-variant bg-surface-container p-5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
              On-Chain Registration
            </span>
            {registered ? (
              <div className="mt-3 flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
                <span className="font-mono text-xs text-on-surface-variant">
                  Meta-address registered on-chain
                  {regHash && (
                    <>
                      {' — '}
                      <a
                        href={horizenTxUrl(regHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline"
                      >
                        {regHash.slice(0, 14)}...
                      </a>
                    </>
                  )}
                </span>
              </div>
            ) : (
              <div className="mt-3">
                <p className="mb-3 font-body text-xs leading-relaxed text-on-surface-variant">
                  Register your meta-address so senders can look you up by wallet address.
                </p>
                <button
                  onClick={registerOnChain}
                  disabled={isRegPending || isRegConfirming}
                  className="h-11 w-full border border-outline-variant font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-30"
                >
                  {isRegPending
                    ? 'Confirm in wallet...'
                    : isRegConfirming
                      ? 'Confirming...'
                      : 'Register On-Chain'}
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={scanPayments}
              disabled={isScanning}
              className="h-12 bg-primary px-6 font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
            >
              {isScanning ? 'Scanning...' : 'Scan for Payments'}
            </button>
            {hasScanned && (
              <span className="font-mono text-xs text-on-surface-variant">
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
            <div className="py-12 text-center">
              <p className="font-heading text-sm uppercase tracking-widest text-outline">
                No transfers found
              </p>
              <p className="mt-2 font-body text-xs text-on-surface-variant">
                No stealth transfers matched your keys.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
