import { useState, useCallback, useEffect, useRef } from 'react';
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
import { CopyButton } from '@/components/CopyButton';

const ANNOUNCER_CONTRACT = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';

export function StellarSend() {
  const { address, isConnected, signTransaction } = useStellarWallet();
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [recipientError, setRecipientError] = useState('');
  const [amountError, setAmountError] = useState('');
  const [balanceError, setBalanceError] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [stealthResult, setStealthResult] = useState<{
    stealthAddress: string;
    ephemeralPubKey: Uint8Array;
    viewTag: number;
  } | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [balanceXLM, setBalanceXLM] = useState<number | null>(null);
  const [isCheckingBalance, setIsCheckingBalance] = useState(false);

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

      let decoded;
      try {
        decoded = decodeStealthMetaAddress(metaAddress);
      } catch (e) {
        setError('Invalid meta-address format');
        setIsPending(false);
        return;
      }
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

  // Helpers & validation
  const feeXLM = 100 / 1e7; // 100 stroops -> XLM

  const isBase32 = (s: string) => /^[A-Z2-7]+=*$/i.test(s.replace(/\s+/g, ''));

  const validateRecipient = (val: string) => {
    if (!val) return 'Recipient is required';
    if (!val.startsWith('st:xlm:')) return 'Must start with "st:xlm:"';
    const body = val.slice('st:xlm:'.length);
    if (!body) return 'Invalid meta-address';
    if (!isBase32(body)) return 'Meta-address must be valid base32';
    return '';
  };

  const validateAmount = (val: string) => {
    if (!val) return 'Amount is required';
    const normalized = val.replace(/,/g, '').trim();
    if (!/^(?:\d+|\d+\.\d{1,7})$/.test(normalized)) return 'Max 7 decimals allowed';
    const n = Number(normalized);
    if (!isFinite(n) || n <= 0) return 'Amount must be positive';
    if (n < 0.0000001) return 'Minimum amount is 0.0000001 XLM';
    return '';
  };

  // Debounced balance check (500ms)
  const balanceTimer = useRef<number | null>(null);
  useEffect(() => {
    setRecipientError('');
    setAmountError('');
    setBalanceError('');

    const recErr = validateRecipient(recipient);
    const amtErr = validateAmount(amount);
    setRecipientError(recErr);
    setAmountError(amtErr);

    // Skip balance lookup if recipient or amount invalid or wallet not connected
    if (recErr || amtErr || !isConnected || !address) {
      setBalanceXLM(null);
      setIsCheckingBalance(false);
      if (balanceTimer.current) {
        window.clearTimeout(balanceTimer.current);
        balanceTimer.current = null;
      }
      return;
    }

    setIsCheckingBalance(true);
    if (balanceTimer.current) window.clearTimeout(balanceTimer.current);
    balanceTimer.current = window.setTimeout(async () => {
      try {
        const horizonUrl = STELLAR_NETWORK.horizonUrl;

        // fetch latest ledger to get base_reserve_in_stroops
        const ledgerRes = await fetch(`${horizonUrl}/ledgers?order=desc&limit=1`);
        const ledgerJson = await ledgerRes.json();
        const baseReserveStroops = Number(
          ledgerJson._embedded?.records?.[0]?.base_reserve_in_stroops || 0,
        );
        const reserveXLM = (baseReserveStroops / 1e7) * 2; // approximate reserve impact

        // fetch sender account for balance
        const accountRes = await fetch(`${horizonUrl}/accounts/${address}`);
        if (!accountRes.ok) throw new Error('Failed to fetch account balance');
        const accountJson = await accountRes.json();
        const nativeBal = Number(
          accountJson.balances?.find((b: any) => b.asset_type === 'native')?.balance || 0,
        );
        setBalanceXLM(nativeBal);

        // determine if stealth address exists (affects reserve requirement)
        let reserveNeeded = 0;
        try {
          const decoded = decodeStealthMetaAddress(recipient);
          const tmp = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
          const stealthExistsRes = await fetch(`${horizonUrl}/accounts/${tmp.stealthAddress}`);
          const stealthExists = stealthExistsRes.ok;
          reserveNeeded = stealthExists ? 0 : reserveXLM;
        } catch {
          reserveNeeded = reserveXLM;
        }

        const amt = Number(amount.replace(/,/g, '').trim());
        const required = amt + feeXLM + reserveNeeded;
        if (required > nativeBal) {
          setBalanceError('Insufficient balance for amount + fee + reserve');
        } else {
          setBalanceError('');
        }
      } catch (e: any) {
        setBalanceError(e?.message || 'Balance check failed');
        setBalanceXLM(null);
      } finally {
        setIsCheckingBalance(false);
        balanceTimer.current = null;
      }
    }, 500);

    return () => {
      if (balanceTimer.current) {
        window.clearTimeout(balanceTimer.current);
        balanceTimer.current = null;
      }
    };
  }, [recipient, amount, address, isConnected]);

  const canSubmit =
    !recipientError &&
    !amountError &&
    !balanceError &&
    !!recipient &&
    !!amount &&
    !isPending &&
    !isCheckingBalance;

  const reset = () => {
    setRecipient('');
    setAmount('');
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
          Stellar Testnet / XLM
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
          Stellar Testnet / XLM
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Send
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Send XLM privately using stealth addresses. The recipient gets funds at a fresh address
          only they can control.
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
                id="recipient-input"
                aria-describedby="recipient-help recipient-error"
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
            <div id="recipient-help" className="mt-1 font-mono text-[11px] text-on-surface-variant">
              Format: st:xlm:&lt;base32&gt;
            </div>
            {recipientError && (
              <div id="recipient-error" className="mt-1 text-sm text-error">
                {recipientError}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Amount
            </label>
            <div className="relative">
              <input
                id="amount-input"
                aria-describedby="amount-help amount-error balance-error"
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                className="h-12 w-full border border-outline-variant bg-surface px-4 pr-16 font-heading text-2xl text-primary placeholder:text-outline focus:border-primary"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-outline">
                XLM
              </span>
            </div>
            <div id="amount-help" className="mt-1 font-mono text-[11px] text-on-surface-variant">
              Positive number, max 7 decimals, min 0.0000001
            </div>
            {amountError && (
              <div id="amount-error" className="mt-1 text-sm text-error">
                {amountError}
              </div>
            )}
            {isCheckingBalance && (
              <div className="mt-1 font-mono text-[11px] text-on-surface-variant">
                Checking balance…
              </div>
            )}
            {balanceXLM !== null && (
              <div className="mt-1 font-mono text-[11px] text-on-surface-variant">
                Balance: {balanceXLM} XLM
              </div>
            )}
            {balanceError && (
              <div id="balance-error" className="mt-1 text-sm text-error">
                {balanceError}
              </div>
            )}
          </div>

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
            disabled={!canSubmit}
            aria-disabled={!canSubmit}
            className="h-12 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {isPending
              ? 'Confirm in wallet...'
              : isCheckingBalance
                ? 'Checking...'
                : 'Send Privately'}
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
