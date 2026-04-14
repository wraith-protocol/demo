import { useState, useCallback } from 'react';
import {
  TransactionBuilder,
  Account,
  Contract,
  xdr,
  nativeToScVal,
  Address,
  Operation,
  Asset,
} from '@stellar/stellar-sdk';
import {
  generateStealthAddress,
  decodeStealthMetaAddress,
  SCHEME_ID,
} from '@wraith-protocol/sdk/chains/stellar';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { stellarTxUrl, stellarAddrUrl } from '@/lib/explorer';
import { STELLAR_NETWORK } from '@/config';

const ANNOUNCER_CONTRACT = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';

export function StellarSend() {
  const { address, isConnected, signTransaction } = useStellarWallet();
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
      const sourceAccount = new Account(address, accountData.sequence);

      const stealthExists = await fetch(`${horizonUrl}/accounts/${result.stealthAddress}`).then(
        (r) => r.ok,
      );

      let classicTx;
      if (stealthExists) {
        classicTx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
          .addOperation(
            Operation.payment({
              destination: result.stealthAddress,
              asset: Asset.native(),
              amount,
            }),
          )
          .setTimeout(30)
          .build();
      } else {
        classicTx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
          .addOperation(
            Operation.createAccount({
              destination: result.stealthAddress,
              startingBalance: amount,
            }),
          )
          .setTimeout(30)
          .build();
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

      // Announce via Soroban (best-effort)
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
        // Announcement is best-effort — payment already succeeded
      }

      setIsSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setIsPending(false);
    }
  }, [address, recipient, amount, signTransaction]);

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
        <p className="text-sm text-on-surface-variant">
          Connect your Freighter wallet to send stealth payments on Stellar.
        </p>
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
          Send XLM to a stealth address on Stellar Testnet.
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
              placeholder="st:xlm:..."
              className="w-full border border-outline-variant bg-surface-container px-4 py-3 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
            />
          </div>

          <div className="space-y-2">
            <label className="font-heading text-[10px] uppercase tracking-widest text-outline">
              Amount (XLM)
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
                href={stellarAddrUrl(stealthResult.stealthAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate font-mono text-xs text-primary underline"
              >
                {stealthResult.stealthAddress}
              </a>
            </div>

            {txHash && (
              <div>
                <span className="font-heading text-[10px] uppercase tracking-widest text-outline">
                  Transaction
                </span>
                <a
                  href={stellarTxUrl(txHash)}
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
