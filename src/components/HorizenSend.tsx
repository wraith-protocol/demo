import { useState } from 'react';
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { buildSendStealth, buildResolveName } from '@wraith-protocol/sdk/chains/evm';
import type { HexString, BuildSendStealthResult } from '@wraith-protocol/sdk/chains/evm';
import { horizenTxUrl, horizenAddrUrl } from '@/lib/explorer';
import { horizenTestnet } from '@/config';

export function HorizenSend() {
  const { isConnected } = useAccount();

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

  if (!isConnected) {
    return (
      <section>
        <h1 className="mb-2 font-heading text-3xl font-bold uppercase tracking-tight text-primary">
          Send
        </h1>
        <p className="text-sm text-on-surface-variant">
          Connect your wallet to send stealth payments on Horizen.
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
          Transfer and announcement happen atomically via the WraithSender contract.
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
              placeholder="st:eth:0x... or name.wraith"
              className="w-full border border-outline-variant bg-surface-container px-4 py-3 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
            />
            {isWraithName && (
              <span className="font-heading text-[10px] uppercase tracking-widest text-on-surface-variant">
                {cleanedName}.wraith
              </span>
            )}
          </div>

          <div className="space-y-2">
            <label className="font-heading text-[10px] uppercase tracking-widest text-outline">
              Amount (ETH)
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
              {isConfirming ? 'Confirming...' : isSuccess ? 'Transfer Complete' : 'Pending'}
            </span>
          </div>

          <div className="space-y-2">
            <div>
              <span className="font-heading text-[10px] uppercase tracking-widest text-outline">
                Stealth Address
              </span>
              <a
                href={horizenAddrUrl(stealthResult.stealthAddress)}
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
                  href={horizenTxUrl(txHash)}
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
