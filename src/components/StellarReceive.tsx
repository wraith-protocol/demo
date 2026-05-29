import { useState, useEffect, useCallback, useRef } from 'react';
import {
  TransactionBuilder,
  Operation,
  Account,
  Asset,
  Contract,
  xdr,
  nativeToScVal,
  Address,
} from '@stellar/stellar-sdk';
import {
  deriveStealthKeys,
  encodeStealthMetaAddress,
  signStellarTransaction,
  STEALTH_SIGNING_MESSAGE,
  SCHEME_ID,
} from '@wraith-protocol/sdk/chains/stellar';
import type { MatchedAnnouncement } from '@wraith-protocol/sdk/chains/stellar';
import { useStealthKeys } from '@/context/StealthKeysContext';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { CopyButton } from '@/components/CopyButton';
import { stellarTxUrl, stellarAddrUrl } from '@/lib/explorer';
import { STELLAR_NETWORK } from '@/config';

const ANNOUNCER_CONTRACT = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
const REGISTRY_CONTRACT = 'CC2LAUCXYOPJ4DV4CYXNXYAXRDVOTMAWFF76W4WFD5OVQBD6TN4PYYJ5';

function StellarStealthRow({
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
        const res = await fetch(`${STELLAR_NETWORK.horizonUrl}/accounts/${match.stealthAddress}`);
        if (!res.ok) {
          setBalance('0');
          return;
        }
        const data = await res.json();
        const xlm = data.balances?.find((b: { asset_type: string }) => b.asset_type === 'native');
        setBalance(xlm?.balance ?? '0');
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
      const horizonUrl = STELLAR_NETWORK.horizonUrl;
      const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

      const res = await fetch(`${horizonUrl}/accounts/${match.stealthAddress}`);
      if (!res.ok) throw new Error('Account not found');
      const account = await res.json();

      const xlmBal = account.balances?.find(
        (b: { asset_type: string }) => b.asset_type === 'native',
      );
      if (!xlmBal || parseFloat(xlmBal.balance) === 0) throw new Error('No XLM balance');

      const subentryCount = account.subentry_count ?? 0;
      const reserve = (2 + subentryCount) * 0.5;
      const sendableAmount = (parseFloat(xlmBal.balance) - reserve - 0.00001).toFixed(7);
      if (parseFloat(sendableAmount) <= 0) throw new Error('Balance too low to cover reserve');

      const sourceAccount = new Account(match.stealthAddress, account.sequence);
      const tx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
        .addOperation(
          Operation.payment({ destination: dest, asset: Asset.native(), amount: sendableAmount }),
        )
        .setTimeout(30)
        .build();

      const txHash = tx.hash();
      const signature = signStellarTransaction(
        txHash,
        match.stealthPrivateScalar,
        match.stealthPubKeyBytes,
      );
      const signatureBase64 = Buffer.from(signature).toString('base64');
      tx.addSignature(match.stealthAddress, signatureBase64);

      const submitRes = await fetch(`${horizonUrl}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `tx=${encodeURIComponent(tx.toXDR())}`,
      });

      const submitData = await submitRes.json();
      if (!submitRes.ok) {
        throw new Error(
          submitData.extras?.result_codes?.transaction || submitData.title || 'Transaction failed',
        );
      }

      setWithdrawHash(submitData.hash);
      onWithdrawn();
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
              href={stellarAddrUrl(match.stealthAddress)}
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
              <span className="font-heading text-lg font-bold text-on-surface">{balance} XLM</span>
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
              placeholder="Destination address (G...)"
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
              href={stellarTxUrl(withdrawHash)}
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
            Reveal secret key
          </button>
        ) : (
          <div className="border border-error/20 bg-error/5 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-[9px] font-semibold uppercase tracking-widest text-error">
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

export function StellarReceive() {
  const { address, isConnected, signMessage, signTransaction } = useStellarWallet();
  const { stellarKeys, stellarMetaAddress, setStellarKeys, setStellarMetaAddress } =
    useStealthKeys();

  const [isDerivingKeys, setIsDerivingKeys] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [matched, setMatched] = useState<MatchedAnnouncement[]>([]);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);
  const [hasScanned, setHasScanned] = useState(false);
  const [error, setError] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [isRegSuccess, setIsRegSuccess] = useState(false);
  const [regHash, setRegHash] = useState<string | null>(null);
  const [isAlreadyRegistered, setIsAlreadyRegistered] = useState(false);

  // Check if already registered on-chain
  useEffect(() => {
    if (!address) return;

    (async () => {
      try {
        const { rpc: rpcMod } = await import('@stellar/stellar-sdk');
        const soroban = new rpcMod.Server(STELLAR_NETWORK.rpcUrl);
        const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

        const accountResponse = await soroban.getAccount(address);
        const sourceAccount = new Account(
          accountResponse.accountId(),
          accountResponse.sequenceNumber(),
        );

        const contract = new Contract(REGISTRY_CONTRACT);
        const tx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
          .addOperation(
            contract.call(
              'stealth_meta_address_of',
              new Address(address).toScVal(),
              nativeToScVal(SCHEME_ID, { type: 'u32' }),
            ),
          )
          .setTimeout(30)
          .build();

        const simulated = await soroban.simulateTransaction(tx);
        if (!('error' in simulated) && 'result' in simulated) {
          setIsAlreadyRegistered(true);
        }
      } catch {
        // Not registered or contract not available
      }
    })();
  }, [address]);

  const registered = isAlreadyRegistered || isRegSuccess;

  const deriveKeysFromWallet = useCallback(async () => {
    setIsDerivingKeys(true);
    setError('');
    try {
      const signature = await signMessage(STEALTH_SIGNING_MESSAGE);
      const derived = deriveStealthKeys(signature);
      setStellarKeys(derived);
      const meta = encodeStealthMetaAddress(derived.spendingPubKey, derived.viewingPubKey);
      setStellarMetaAddress(meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Key derivation failed');
    } finally {
      setIsDerivingKeys(false);
    }
  }, [signMessage, setStellarKeys, setStellarMetaAddress]);

  const registerOnChain = useCallback(async () => {
    if (!stellarKeys || !address) return;
    setIsRegistering(true);
    setError('');
    try {
      const { rpc: rpcMod } = await import('@stellar/stellar-sdk');
      const soroban = new rpcMod.Server(STELLAR_NETWORK.rpcUrl);
      const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

      const accountResponse = await soroban.getAccount(address);
      const sourceAccount = new Account(
        accountResponse.accountId(),
        accountResponse.sequenceNumber(),
      );

      const contract = new Contract(REGISTRY_CONTRACT);
      const metaAddressBytes = new Uint8Array(64);
      metaAddressBytes.set(stellarKeys.spendingPubKey, 0);
      metaAddressBytes.set(stellarKeys.viewingPubKey, 32);

      const tx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
        .addOperation(
          contract.call(
            'register_keys',
            new Address(address).toScVal(),
            nativeToScVal(SCHEME_ID, { type: 'u32' }),
            xdr.ScVal.scvBytes(Buffer.from(metaAddressBytes)),
          ),
        )
        .setTimeout(30)
        .build();

      const simulated = await soroban.simulateTransaction(tx);
      if ('error' in simulated) {
        throw new Error((simulated as { error: string }).error || 'Simulation failed');
      }

      const assembled = rpcMod
        .assembleTransaction(tx, simulated as Parameters<typeof rpcMod.assembleTransaction>[1])
        .build();

      const signedXdr = await signTransaction(assembled.toXDR());
      const response = await soroban.sendTransaction(
        TransactionBuilder.fromXDR(signedXdr, networkPassphrase),
      );

      if (response.status === 'ERROR') throw new Error('Transaction submission failed');

      setRegHash(response.hash);

      let attempts = 0;
      while (attempts < 30) {
        try {
          const result = await soroban.getTransaction(response.hash);
          if (result.status === 'NOT_FOUND') {
            attempts++;
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          if (result.status === 'SUCCESS') {
            setIsRegSuccess(true);
          }
          break;
        } catch (pollErr: unknown) {
          if (pollErr instanceof Error && pollErr.message?.includes('Bad union switch')) {
            setIsRegSuccess(true);
            break;
          }
          throw pollErr;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setIsRegistering(false);
    }
  }, [stellarKeys, address, signTransaction]);

  const scanPayments = useCallback(async () => {
    if (!stellarKeys) return;
    setIsScanning(true);
    setError('');

    try {
      if (workerRef.current) {
        workerRef.current.terminate();
      }

      workerRef.current = new Worker(
        new URL('../workers/stellar-scanner.worker.ts', import.meta.url),
        { type: 'module' },
      );

      workerRef.current.onmessage = (e) => {
        if (e.data.type === 'SUCCESS') {
          setMatched(e.data.results);
          setHasScanned(true);
          setIsScanning(false);
        } else if (e.data.type === 'ERROR') {
          setError(e.data.error);
          setIsScanning(false);
        }
      };

      workerRef.current.onerror = () => {
        setError('Worker crashed');
        setIsScanning(false);
      };

      workerRef.current.postMessage({
        rpcUrl: STELLAR_NETWORK.rpcUrl,
        announcerContract: ANNOUNCER_CONTRACT,
        viewingKey: stellarKeys.viewingKey,
        spendingPubKey: stellarKeys.spendingPubKey,
        spendingScalar: stellarKeys.spendingScalar,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start worker');
      setIsScanning(false);
    }
  }, [stellarKeys]);

  if (!isConnected) {
    return (
      <section className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Stellar Testnet / XLM
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Receive
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Connect your Freighter wallet to scan for incoming stealth transfers on Stellar.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Stellar Testnet / XLM
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Receive
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Derive your stealth keys, register on-chain, then scan for payments.
        </p>
      </div>

      {!stellarKeys && (
        <div className="flex flex-col gap-4">
          <button
            onClick={deriveKeysFromWallet}
            disabled={isDerivingKeys}
            className="h-12 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {isDerivingKeys ? 'Sign in wallet...' : 'Derive Keys'}
          </button>
          {error && <p className="text-sm text-error">{error}</p>}
        </div>
      )}

      {stellarKeys && stellarMetaAddress && (
        <>
          <div className="border border-outline-variant bg-surface-container p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Your Stealth Meta-Address
              </span>
              <CopyButton text={stellarMetaAddress} />
            </div>
            <code className="block break-all font-mono text-xs leading-relaxed text-primary">
              {stellarMetaAddress}
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
                        href={stellarTxUrl(regHash)}
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
                  disabled={isRegistering}
                  className="h-11 w-full border border-outline-variant font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-30"
                >
                  {isRegistering ? 'Registering...' : 'Register On-Chain'}
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
                <StellarStealthRow key={i} match={m} onWithdrawn={() => {}} />
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
