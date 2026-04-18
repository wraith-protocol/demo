import { useState } from 'react';
import { useAccount, useBalance, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { buildSendStealth, buildResolveName } from '@wraith-protocol/sdk/chains/evm';
import type { HexString, BuildSendStealthResult } from '@wraith-protocol/sdk/chains/evm';
import { horizenTxUrl, horizenAddrUrl } from '@/lib/explorer';
import { horizenTestnet } from '@/config';
import { CopyButton } from '@/components/CopyButton';

export function HorizenSend() {
  const { isConnected, address } = useAccount();
  const { data: balanceData } = useBalance({ address });

  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [stealthResult, setStealthResult] = useState<BuildSendStealthResult | null>(null);

  const { sendTransaction, data: txHash, isPending } = useSendTransaction();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const isMetaAddress = recipient.startsWith('st:eth:');
  const cleanedName = recipient.replace(/\.wraith$/i, '').toLowerCase();
  const isWraithName = !isMetaAddress && cleanedName.length >= 3 && /^[a-z0-9]+$/.test(cleanedName);

  const handleSend = async () => {
    setError('');

    let metaAddress = recipient;

    try {
      if (isWraithName) {
        const resolveCall = buildResolveName({ name: cleanedName, chain: 'horizen' });
        const response = await fetch(horizenTestnet.rpcUrls.default.http[0], {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_call',
            params: [{ to: resolveCall.to, data: resolveCall.data }, 'latest'],
          }),
        });
        const json = await response.json();
        if (!json.result || json.result === '0x' || json.result.length <= 66) {
          setError('Name not found');
          return;
        }
        const metaBytes = ('0x' + json.result.slice(130).replace(/0+$/, '')) as HexString;
        metaAddress = `st:eth:${metaBytes}`;
      }

      if (!metaAddress.startsWith('st:eth:')) {
        setError('Enter a valid meta-address (st:eth:0x...) or .wraith name');
        return;
      }

      const result = buildSendStealth({
        recipientMetaAddress: metaAddress,
        amount,
        chain: 'horizen',
      });

      setStealthResult(result);

      sendTransaction({
        to: result.transaction.to as `0x${string}`,
        data: result.transaction.data as `0x${string}`,
        value: result.transaction.value,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
    }
  };

  const reset = () => {
    setRecipient('');
    setAmount('');
    setStealthResult(null);
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

  const handleMax = () => {
    if (balanceData) {
      const maxVal = parseFloat(balanceData.formatted);
      const safeMax = Math.max(0, maxVal - 0.001).toFixed(6);
      setAmount(safeMax);
    }
  };

  if (!isConnected) {
    return (
      <section className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Horizen Testnet / ETH
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Send
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Connect your wallet to send stealth payments on Horizen.
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
          Send
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Send ETH privately using stealth addresses. The recipient gets funds at a fresh address
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
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="st:eth:0x... or name.wraith"
                className="h-12 w-full border border-outline-variant bg-surface px-4 pr-20 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
              />
              <button
                onClick={handlePaste}
                className="absolute right-3 top-1/2 -translate-y-1/2 font-heading text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
              >
                Paste
              </button>
            </div>
            {isWraithName && (
              <span className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
                {cleanedName}.wraith
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Amount
            </label>
            <div className="relative">
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                className="h-12 w-full border border-outline-variant bg-surface px-4 pr-24 font-heading text-2xl text-primary placeholder:text-outline focus:border-primary"
              />
              <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
                <button
                  onClick={handleMax}
                  className="font-heading text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
                >
                  Max
                </button>
                <span className="font-mono text-xs text-outline">ETH</span>
              </div>
            </div>
            {balanceData && (
              <span className="font-mono text-[10px] text-outline">
                Balance: {parseFloat(balanceData.formatted).toFixed(6)} ETH
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-outline-variant/30 pt-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Network fee
              </span>
              <span className="font-mono text-[10px] text-on-surface-variant">Paid by sender</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Announcer contract
              </span>
              <span className="font-mono text-[10px] text-on-surface-variant">WraithSender</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Expected confirmation
              </span>
              <span className="font-mono text-[10px] text-on-surface-variant">~5 seconds</span>
            </div>
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          <button
            onClick={handleSend}
            disabled={!recipient || !amount || isPending}
            className="h-12 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {isPending ? 'Confirm in wallet...' : 'Send Privately'}
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
              {isConfirming ? 'Confirming...' : isSuccess ? 'Transfer Complete' : 'Pending'}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Stealth Address
              </span>
              <div className="mt-0.5 flex items-center gap-2">
                <a
                  href={horizenAddrUrl(stealthResult.stealthAddress)}
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
                    href={horizenTxUrl(txHash)}
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

            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Ephemeral Public Key
              </span>
              <p className="mt-0.5 truncate font-mono text-xs text-on-surface-variant">
                {stealthResult.ephemeralPubKey}
              </p>
            </div>
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
