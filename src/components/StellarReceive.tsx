import { useState, useEffect, useCallback } from 'react';
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
  scanAnnouncements,
  signStellarTransaction,
  bytesToHex,
  STEALTH_SIGNING_MESSAGE,
  SCHEME_ID,
} from '@wraith-protocol/sdk/chains/stellar';
import type { Announcement, MatchedAnnouncement } from '@wraith-protocol/sdk/chains/stellar';
import { useStealthKeys } from '@/context/StealthKeysContext';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { CopyButton } from '@/components/CopyButton';
import { stellarTxUrl, stellarAddrUrl } from '@/lib/explorer';
import { STELLAR_NETWORK } from '@/config';

const ANNOUNCER_CONTRACT = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
const REGISTRY_CONTRACT = 'CC2LAUCXYOPJ4DV4CYXNXYAXRDVOTMAWFF76W4WFD5OVQBD6TN4PYYJ5';

async function fetchAnnouncementEvents(
  rpcUrl: string,
  contractId: string,
): Promise<Announcement[]> {
  const all: Announcement[] = [];

  try {
    let startLedger = 1;
    const probeRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'getEvents',
        params: {
          startLedger: 1,
          filters: [{ type: 'contract', contractIds: [contractId] }],
          pagination: { limit: 1 },
        },
      }),
    });
    const probeData = await probeRes.json();

    if (probeData.error?.message) {
      const match = probeData.error.message.match(/range:\s*(\d+)\s*-\s*(\d+)/);
      if (match) {
        const oldest = parseInt(match[1], 10);
        const latest = parseInt(match[2], 10);
        startLedger = Math.max(oldest, latest - 5000);
      } else {
        return all;
      }
    }

    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const params: Record<string, unknown> = {
        filters: [{ type: 'contract', contractIds: [contractId] }],
        pagination: { limit: 1000 },
      };

      if (cursor) {
        (params.pagination as Record<string, unknown>).cursor = cursor;
      } else {
        params.startLedger = startLedger;
      }

      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'getEvents', params }),
      });

      const data = await res.json();
      const events = data.result?.events ?? [];

      for (const event of events) {
        try {
          const ann = parseAnnouncementEvent(event);
          if (ann) all.push(ann);
        } catch {
          // Skip malformed
        }
      }

      if (events.length < 1000) {
        hasMore = false;
      } else {
        cursor = data.result?.cursor;
        if (!cursor) hasMore = false;
      }
    }
  } catch {
    // Events API may not be available
  }

  return all;
}

function parseAnnouncementEvent(event: Record<string, unknown>): Announcement | null {
  const topics = event.topic as string[];
  if (!topics || topics.length < 3) return null;

  const schemeIdScVal = xdr.ScVal.fromXDR(topics[1], 'base64');
  const schemeId = schemeIdScVal.u32();

  const stealthScVal = xdr.ScVal.fromXDR(topics[2], 'base64');
  const stealthScAddress = stealthScVal.address();
  const stealthAddress = Address.fromScAddress(stealthScAddress).toString();

  const valueScVal = xdr.ScVal.fromXDR(event.value as string, 'base64');
  const valueVec = valueScVal.vec();
  if (!valueVec || valueVec.length < 3) return null;

  const callerScAddress = valueVec[0].address();
  const caller = Address.fromScAddress(callerScAddress).toString();

  const ephBytes = valueVec[1].bytes();
  const ephemeralPubKey = bytesToHex(new Uint8Array(ephBytes));

  const metaBytes = valueVec[2].bytes();
  const metadata = bytesToHex(new Uint8Array(metaBytes));

  return { schemeId, stealthAddress, caller, ephemeralPubKey, metadata };
}

function StellarStealthRow({
  match,
  onWithdrawn,
}: {
  match: MatchedAnnouncement;
  onWithdrawn: () => void;
}) {
  const { address, signTransaction } = useStellarWallet();
  const [balance, setBalance] = useState<string | null>(null);
  const [loadingBal, setLoadingBal] = useState(true);
  const [dest, setDest] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawHash, setWithdrawHash] = useState<string | null>(null);
  const [feeBumpHash, setFeeBumpHash] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showSponsorPrompt, setShowSponsorPrompt] = useState(false);

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

      const currentBalance = parseFloat(xlmBal.balance);
      const subentryCount = account.subentry_count ?? 0;
      const baseReserve = 0.5; // 0.5 XLM per base reserve
      const minAccountReserve = (2 + subentryCount) * baseReserve;
      const estimatedFee = 0.00001; // 100 stroops base fee
      const feeBumpFee = 0.0001; // Additional fee for fee-bump envelope

      // Check if we need sponsored withdrawal
      // We need sponsorship if balance can't cover: amount + fee + reserve
      // For simplicity, if balance < 2 XLM (base reserve + buffer), we'll use mergeAccount
      const needsSponsor = currentBalance < minAccountReserve + estimatedFee + feeBumpFee;

      if (needsSponsor && !address) {
        throw new Error('Sponsored withdrawal requires connected wallet');
      }

      if (needsSponsor) {
        setShowSponsorPrompt(true);
        setWithdrawing(false);
        return;
      }

      // Standard withdrawal (account can pay its own fees)
      const sendableAmount = (currentBalance - minAccountReserve - estimatedFee).toFixed(7);
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

  const handleSponsoredWithdraw = async () => {
    if (!dest || !address) return;
    setError('');
    setWithdrawing(true);
    setShowSponsorPrompt(false);

    try {
      const horizonUrl = STELLAR_NETWORK.horizonUrl;
      const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

      // Fetch stealth account
      const stealthRes = await fetch(`${horizonUrl}/accounts/${match.stealthAddress}`);
      if (!stealthRes.ok) throw new Error('Stealth account not found');
      const stealthAccount = await stealthRes.json();

      const xlmBal = stealthAccount.balances?.find(
        (b: { asset_type: string }) => b.asset_type === 'native',
      );
      if (!xlmBal || parseFloat(xlmBal.balance) === 0) throw new Error('No XLM balance');

      // Build inner transaction: mergeAccount to recover all XLM including base reserve
      const stealthSourceAccount = new Account(match.stealthAddress, stealthAccount.sequence);
      const innerTx = new TransactionBuilder(stealthSourceAccount, {
        fee: '0', // Fee will be paid by outer fee-bump transaction
        networkPassphrase,
      })
        .addOperation(
          Operation.accountMerge({
            destination: dest,
          }),
        )
        .setTimeout(30)
        .build();

      // Sign inner transaction with stealth key
      const innerTxHash = innerTx.hash();
      const innerSignature = signStellarTransaction(
        innerTxHash,
        match.stealthPrivateScalar,
        match.stealthPubKeyBytes,
      );
      const innerSignatureBase64 = Buffer.from(innerSignature).toString('base64');
      innerTx.addSignature(match.stealthAddress, innerSignatureBase64);

      // Fetch sponsor account for fee-bump
      const sponsorRes = await fetch(`${horizonUrl}/accounts/${address}`);
      if (!sponsorRes.ok) throw new Error('Sponsor account not found');

      // Build fee-bump transaction
      // Fee-bump fee must be higher than inner tx fee (which is 0)
      // Set to 1000 stroops (0.0001 XLM) to ensure it's accepted
      const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
        address, // fee source (sponsor)
        '1000', // fee in stroops
        innerTx,
        networkPassphrase,
      );

      // Sign fee-bump with sponsor wallet (Freighter will prompt)
      const feeBumpXdr = feeBumpTx.toXDR();
      const signedFeeBumpXdr = await signTransaction(feeBumpXdr);

      // Submit fee-bump transaction
      const submitRes = await fetch(`${horizonUrl}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `tx=${encodeURIComponent(signedFeeBumpXdr)}`,
      });

      const submitData = await submitRes.json();
      if (!submitRes.ok) {
        throw new Error(
          submitData.extras?.result_codes?.transaction || submitData.title || 'Transaction failed',
        );
      }

      // Fee-bump transactions return the outer hash
      setFeeBumpHash(submitData.hash);
      setWithdrawHash(submitData.hash); // For UI consistency
      onWithdrawn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sponsored withdraw failed');
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

      {showSponsorPrompt && (
        <div className="border border-tertiary bg-tertiary/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
            <span className="font-heading text-xs font-semibold uppercase tracking-widest text-tertiary">
              Sponsored Withdrawal Required
            </span>
          </div>
          <p className="mb-3 font-body text-xs leading-relaxed text-on-surface-variant">
            This stealth address can't pay its own fees. Your connected wallet will sponsor the
            transaction and pay the fee. Freighter will prompt you to sign the fee-bump transaction.
          </p>
          <p className="mb-4 font-body text-xs leading-relaxed text-on-surface-variant">
            The entire balance (including base reserve) will be merged into the destination address.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleSponsoredWithdraw}
              disabled={withdrawing}
              className="h-10 flex-1 bg-tertiary px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
            >
              {withdrawing ? 'Processing...' : 'Pay with Connected Wallet'}
            </button>
            <button
              onClick={() => {
                setShowSponsorPrompt(false);
              }}
              disabled={withdrawing}
              className="h-10 border border-outline-variant px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-outline transition-colors hover:bg-surface-bright disabled:opacity-30"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-error">{error}</p>}

      {withdrawHash && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
            <span className="font-mono text-[10px] text-on-surface-variant">
              {feeBumpHash ? 'Sponsored withdrawal complete' : 'Withdrawn'} —{' '}
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
          {feeBumpHash && (
            <p className="font-body text-[10px] leading-relaxed text-on-surface-variant">
              Fee-bump transaction sponsored by your connected wallet. All funds including base
              reserve have been recovered.
            </p>
          )}
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
      const announcements = await fetchAnnouncementEvents(
        STELLAR_NETWORK.rpcUrl,
        ANNOUNCER_CONTRACT,
      );
      const results = scanAnnouncements(
        announcements,
        stellarKeys.viewingKey,
        stellarKeys.spendingPubKey,
        stellarKeys.spendingScalar,
      );
      setMatched(results);
      setHasScanned(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
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
