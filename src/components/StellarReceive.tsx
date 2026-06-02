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
import { StellarMatchCard } from '@/components/StellarMatchCard';
import { StellarReceiveView } from '@/components/StellarReceiveView';
import { STELLAR_NETWORK } from '@/config';

const ANNOUNCER_CONTRACT = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
const REGISTRY_CONTRACT = 'CC2LAUCXYOPJ4DV4CYXNXYAXRDVOTMAWFF76W4WFD5OVQBD6TN4PYYJ5';

function StellarMatchCardContainer({
  match,
  onWithdrawn,
}: {
  match: MatchedAnnouncement;
  onWithdrawn: () => void;
}) {
  const { address, signTransaction } = useStellarWallet();
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceState, setBalanceState] = useState<'loading' | 'loaded' | 'error'>('loading');
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
        setBalanceState('loaded');
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
    <StellarMatchCard
      stealthAddress={match.stealthAddress}
      scalarHex={scalarHex}
      balance={balance}
      balanceState={balanceState}
      dest={dest}
      withdrawing={withdrawing}
      withdrawHash={withdrawHash}
      feeBumpHash={feeBumpHash}
      error={error}
      showKey={showKey}
      showSponsorPrompt={showSponsorPrompt}
      onDestChange={setDest}
      onWithdraw={handleWithdraw}
      onSponsoredWithdraw={handleSponsoredWithdraw}
      onCancelSponsor={() => setShowSponsorPrompt(false)}
      onRevealKey={() => setShowKey(true)}
    />
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

  return (
    <StellarReceiveView
      isConnected={isConnected}
      isDerivingKeys={isDerivingKeys}
      keysDerived={!!stellarKeys}
      metaAddress={stellarMetaAddress}
      registered={registered}
      isRegistering={isRegistering}
      regHash={regHash}
      isScanning={isScanning}
      hasScanned={hasScanned}
      matchCount={matched.length}
      error={error}
      onDeriveKeys={deriveKeysFromWallet}
      onRegister={registerOnChain}
      onScan={scanPayments}
      matches={matched.map((m, i) => (
        <StellarMatchCardContainer key={i} match={m} onWithdrawn={() => {}} />
      ))}
    />
  );
}
