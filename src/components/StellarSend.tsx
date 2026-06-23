import { useState, useCallback, useEffect } from 'react';
import {
  TransactionBuilder,
  Account,
  Contract,
  xdr,
  nativeToScVal,
  Address,
} from '@stellar/stellar-sdk';
import {
  generateStealthAddress,
  decodeStealthMetaAddress,
  SCHEME_ID,
} from '@wraith-protocol/sdk/chains/stellar';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { stellarTxUrl, stellarAddrUrl } from '@/lib/explorer';
import { STELLAR_NETWORK } from '@/config';
import { CopyButton } from '@/components/CopyButton';
import {
  ASSET_KEYS,
  STELLAR_ASSETS,
  type StellarAssetKey,
  checkTrustline,
  checkAccountExists,
  buildPaymentTx,
  buildCreateAccountTx,
  trustlineLaboratoryUrl,
} from '@/lib/stellar-assets';

const ANNOUNCER_CONTRACT = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';

export function StellarSend() {
  const { address, isConnected, signTransaction } = useStellarWallet();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<StellarAssetKey>('XLM');
  const [error, setError] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [stealthResult, setStealthResult] = useState<{
    stealthAddress: string;
    ephemeralPubKey: Uint8Array;
    viewTag: number;
  } | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const [trustlineStatus, setTrustlineStatus] = useState<{
    checking: boolean;
    hasTrustline: boolean;
    balance: string;
  }>({ checking: false, hasTrustline: true, balance: '0' });

  const isNonNative = selectedAsset !== 'XLM';

  useEffect(() => {
    if (!recipient || !recipient.startsWith('st:xlm:')) {
      setTrustlineStatus({ checking: false, hasTrustline: true, balance: '0' });
      return;
    }

    let cancelled = false;

    (async () => {
      setTrustlineStatus((s) => ({ ...s, checking: true }));
      try {
        const decoded = decodeStealthMetaAddress(recipient);
        const result = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);

        const exists = await checkAccountExists(result.stealthAddress);
        if (!exists) {
          setTrustlineStatus({ checking: false, hasTrustline: false, balance: '0' });
          return;
        }

        const status = await checkTrustline(result.stealthAddress, selectedAsset);
        if (!cancelled) {
          setTrustlineStatus({ checking: false, ...status });
        }
      } catch {
        if (!cancelled) {
          setTrustlineStatus({ checking: false, hasTrustline: true, balance: '0' });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [recipient, selectedAsset]);

  const handleSend = useCallback(async () => {
    if (!address) {
      setError('Wallet not connected');
      return;
    }

    setError('');
    setIsPending(true);

    try {
      const metaAddress = recipient;
      if (!metaAddress.startsWith('st:xlm:')) {
        setError('Enter a valid Stellar meta-address (st:xlm:...)');
        setIsPending(false);
        return;
      }

      const decoded = decodeStealthMetaAddress(metaAddress);
      const result = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
      setStealthResult(result);

      const horizonUrl = STELLAR_NETWORK.horizonUrl;
      const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

      const accountRes = await fetch(`${horizonUrl}/accounts/${address}`);
      if (!accountRes.ok) throw new Error('Failed to load sender account');
      const accountData = await accountRes.json();

      const stealthExists = await checkAccountExists(result.stealthAddress);

      let classicTx;
      if (selectedAsset === 'XLM') {
        if (stealthExists) {
          classicTx = buildPaymentTx({
            sourceAddress: address,
            sequence: accountData.sequence,
            destination: result.stealthAddress,
            amount,
            assetKey: 'XLM',
            networkPassphrase,
          });
        } else {
          classicTx = buildCreateAccountTx({
            sourceAddress: address,
            sequence: accountData.sequence,
            destination: result.stealthAddress,
            startingBalance: amount,
            networkPassphrase,
          });
        }
      } else {
        if (!stealthExists) {
          throw new Error(
            'Recipient stealth account does not exist. Send at least 2 XLM first to create the account, then send USDC.',
          );
        }

        const tl = await checkTrustline(result.stealthAddress, selectedAsset);
        if (!tl.hasTrustline) {
          throw new Error(
            `Recipient has no trustline for ${selectedAsset}. Ask them to add a trustline first.`,
          );
        }

        classicTx = buildPaymentTx({
          sourceAddress: address,
          sequence: accountData.sequence,
          destination: result.stealthAddress,
          amount,
          assetKey: selectedAsset,
          networkPassphrase,
        });
      }

      const signedXdr = await signTransaction(classicTx.toXDR());

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

      try {
        const { rpc: rpcMod } = await import('@stellar/stellar-sdk');
        const soroban = new rpcMod.Server(STELLAR_NETWORK.rpcUrl);
        const announcerContract = new Contract(ANNOUNCER_CONTRACT);

        const freshRes = await fetch(`${horizonUrl}/accounts/${address}`);
        const freshData = await freshRes.json();
        const freshAccount = new Account(address, freshData.sequence);

        const announceTx = new TransactionBuilder(freshAccount, { fee: '100', networkPassphrase })
          .addOperation(
            announcerContract.call(
              'announce',
              nativeToScVal(SCHEME_ID, { type: 'u32' }),
              new Address(result.stealthAddress).toScVal(),
              xdr.ScVal.scvBytes(Buffer.from(result.ephemeralPubKey)),
              xdr.ScVal.scvBytes(Buffer.from([result.viewTag])),
            ),
          )
          .setTimeout(30)
          .build();

        const simulated = await soroban.simulateTransaction(announceTx);
        if (!('error' in simulated)) {
          const assembled = rpcMod
            .assembleTransaction(
              announceTx,
              simulated as Parameters<typeof rpcMod.assembleTransaction>[1],
            )
            .build();

          const signedAnnounce = await signTransaction(assembled.toXDR());
          await soroban.sendTransaction(
            TransactionBuilder.fromXDR(signedAnnounce, networkPassphrase),
          );
        }
      } catch {
        // Announcement is best-effort
      }

      setIsSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setIsPending(false);
    }
  }, [address, recipient, amount, selectedAsset, signTransaction]);

  const reset = () => {
    setRecipient('');
    setAmount('');
    setSelectedAsset('XLM');
    setStealthResult(null);
    setTxHash(null);
    setIsSuccess(false);
    setError('');
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setRecipient(text);
    } catch {
      // Clipboard access denied
    }
  };

  if (!isConnected) {
    return (
      <section className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Stellar Testnet
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Send
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Connect your Freighter wallet to send stealth payments on Stellar.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Stellar Testnet
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Send
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Send XLM or USDC privately using stealth addresses. The recipient gets funds at a fresh
          address only they can control.
        </p>
      </div>

      {!stealthResult && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Recipient Meta-Address
            </label>
            <div className="relative">
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="st:xlm:..."
                className="h-12 w-full border border-outline-variant bg-surface px-4 pr-20 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
              />
              <button
                onClick={handlePaste}
                className="absolute right-3 top-1/2 -translate-y-1/2 font-heading text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
              >
                Paste
              </button>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1 flex flex-col gap-1.5">
              <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Amount
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.0"
                  className="h-12 w-full border border-outline-variant bg-surface px-4 pr-16 font-heading text-2xl text-primary placeholder:text-outline focus:border-primary"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-outline">
                  {selectedAsset}
                </span>
              </div>
            </div>

            <div className="w-28 flex flex-col gap-1.5">
              <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Asset
              </label>
              <select
                value={selectedAsset}
                onChange={(e) => setSelectedAsset(e.target.value as StellarAssetKey)}
                className="h-12 w-full border border-outline-variant bg-surface px-3 font-heading text-sm text-primary focus:border-primary"
              >
                {ASSET_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {STELLAR_ASSETS[key].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isNonNative && !trustlineStatus.checking && !trustlineStatus.hasTrustline && (
            <div className="border border-yellow-500/30 bg-yellow-500/5 p-3">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-widest text-yellow-400">
                Trustline Required
              </p>
              <p className="mt-1 font-body text-xs text-on-surface-variant">
                The recipient stealth address does not have a{' '}
                <span className="font-mono text-primary">{selectedAsset}</span> trustline. They must
                add one before receiving this asset.{' '}
                <a
                  href={trustlineLaboratoryUrl(selectedAsset)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  Add Trustline on Stellar Laboratory
                </a>
              </p>
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-outline-variant/30 pt-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Network fee
              </span>
              <span className="font-mono text-[10px] text-on-surface-variant">100 stroops</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Announcer contract
              </span>
              <span className="font-mono text-[10px] text-on-surface-variant">Soroban</span>
            </div>
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          <button
            onClick={handleSend}
            disabled={
              !recipient || !amount || isPending || (isNonNative && !trustlineStatus.hasTrustline)
            }
            className="h-12 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {isPending
              ? 'Confirm in wallet...'
              : `Send ${STELLAR_ASSETS[selectedAsset].label} Privately`}
          </button>
        </div>
      )}

      {stealthResult && (
        <div className="flex flex-col gap-5 border border-outline-variant bg-surface-container p-5 sm:p-6">
          <div className="flex items-center gap-2">
            {isSuccess ? (
              <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
            ) : (
              <span className="inline-block h-1.5 w-1.5 animate-pulse bg-primary"></span>
            )}
            <span className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface">
              {isSuccess ? 'Transfer Complete' : 'Pending'}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Stealth Address
              </span>
              <div className="mt-0.5 flex items-center gap-2">
                <a
                  href={stellarAddrUrl(stealthResult.stealthAddress)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate font-mono text-xs text-primary underline"
                >
                  {stealthResult.stealthAddress}
                </a>
                <CopyButton text={stealthResult.stealthAddress} />
              </div>
            </div>

            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Asset
              </span>
              <span className="ml-2 font-mono text-xs text-primary">
                {STELLAR_ASSETS[selectedAsset].label}
              </span>
            </div>

            {txHash && (
              <div>
                <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                  Transaction Hash
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
          </div>

          {isSuccess && (
            <button
              onClick={reset}
              className="h-11 w-full border border-outline-variant font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
            >
              New Transfer
            </button>
          )}
        </div>
      )}
    </section>
  );
}
