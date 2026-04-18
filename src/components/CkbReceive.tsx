import { useState, useCallback } from 'react';
import { ccc } from '@ckb-ccc/connector-react';
import {
  deriveStealthKeys,
  encodeStealthMetaAddress,
  scanStealthCells,
  fetchStealthCells,
  STEALTH_SIGNING_MESSAGE,
  type MatchedStealthCell,
  type HexString,
} from '@wraith-protocol/sdk/chains/ckb';
import { useStealthKeys } from '@/context/StealthKeysContext';
import { CopyButton } from '@/components/CopyButton';

function CkbStealthRow({ match }: { match: MatchedStealthCell }) {
  const [showKey, setShowKey] = useState(false);
  const keyHex = match.stealthPrivateKey.slice(2);
  const capacityCkb = (Number(match.capacity) / 1e8).toFixed(4);

  return (
    <div className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Stealth Hash
          </span>
          <div className="mt-0.5 flex items-center gap-2">
            <p className="truncate font-mono text-xs text-primary">{match.stealthPubKeyHash}</p>
            <CopyButton text={match.stealthPubKeyHash} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
          <span className="font-heading text-lg font-bold text-on-surface">{capacityCkb} CKB</span>
        </div>
      </div>

      <div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">Cell</span>
        <p className="mt-0.5 truncate font-mono text-[11px] text-on-surface-variant">
          {match.txHash}:{match.index}
        </p>
      </div>

      <div className="border border-outline-variant bg-surface p-4">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-outline">
          Withdraw
        </p>
        <p className="font-body text-xs leading-relaxed text-on-surface-variant">
          Use the private key below to sign a CKB transaction consuming this Cell.
        </p>
      </div>

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
              <CopyButton text={keyHex} />
            </div>
            <code className="break-all font-mono text-[11px] text-on-surface">{keyHex}</code>
          </div>
        )}
      </div>
    </div>
  );
}

export function CkbReceive() {
  const { wallet } = ccc.useCcc();
  const signer = ccc.useSigner();
  const { ckbKeys, ckbMetaAddress, setCkbKeys, setCkbMetaAddress } = useStealthKeys();

  const [isDerivingKeys, setIsDerivingKeys] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [matched, setMatched] = useState<MatchedStealthCell[]>([]);
  const [hasScanned, setHasScanned] = useState(false);
  const [error, setError] = useState('');

  const deriveKeys = useCallback(async () => {
    if (!signer) {
      setError('Connect your CKB wallet first');
      return;
    }
    setIsDerivingKeys(true);
    setError('');
    try {
      const sig = await (signer as any).signMessageRaw(STEALTH_SIGNING_MESSAGE);
      const sigStr = typeof sig === 'string' ? sig : `0x${Buffer.from(sig).toString('hex')}`;
      const sigHex = sigStr.startsWith('0x') ? sigStr : `0x${sigStr}`;

      if (sigHex.length < 132) {
        throw new Error(
          `Signature too short (${(sigHex.length - 2) / 2} bytes). Need 65 bytes. Your wallet may not support raw secp256k1 signing.`,
        );
      }

      const derived = deriveStealthKeys(sigHex as HexString);
      setCkbKeys(derived);
      const meta = encodeStealthMetaAddress(derived.spendingPubKey, derived.viewingPubKey);
      setCkbMetaAddress(meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Key derivation failed');
    } finally {
      setIsDerivingKeys(false);
    }
  }, [signer, setCkbKeys, setCkbMetaAddress]);

  const scanPayments = useCallback(async () => {
    if (!ckbKeys) return;
    setIsScanning(true);
    setError('');
    try {
      const cells = await fetchStealthCells('ckb');
      const results = scanStealthCells(
        cells,
        ckbKeys.viewingKey,
        ckbKeys.spendingPubKey,
        ckbKeys.spendingKey,
      );
      setMatched(results);
      setHasScanned(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setIsScanning(false);
    }
  }, [ckbKeys]);

  if (!wallet) {
    return (
      <section className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          CKB Testnet / CKB
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Receive
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Connect your CKB wallet to scan for stealth payments.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          CKB Testnet / CKB
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Receive
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Derive your stealth keys, then scan for stealth Cells on CKB Testnet.
        </p>
      </div>

      {!ckbKeys && (
        <div className="flex flex-col gap-4">
          <button
            onClick={deriveKeys}
            disabled={isDerivingKeys}
            className="h-12 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {isDerivingKeys ? 'Sign in wallet...' : 'Derive Stealth Keys'}
          </button>
          {error && <p className="text-sm text-error">{error}</p>}
        </div>
      )}

      {ckbKeys && ckbMetaAddress && (
        <>
          <div className="border border-outline-variant bg-surface-container p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Your Stealth Meta-Address
              </span>
              <CopyButton text={ckbMetaAddress} />
            </div>
            <code className="block break-all font-mono text-xs leading-relaxed text-primary">
              {ckbMetaAddress}
            </code>
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={scanPayments}
              disabled={isScanning}
              className="h-12 bg-primary px-6 font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
            >
              {isScanning ? 'Scanning...' : 'Scan for Cells'}
            </button>
            {hasScanned && (
              <span className="font-mono text-xs text-on-surface-variant">
                {matched.length} cell{matched.length !== 1 ? 's' : ''} found
              </span>
            )}
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          {matched.length > 0 && (
            <div className="flex flex-col gap-4">
              {matched.map((m, i) => (
                <CkbStealthRow key={i} match={m} />
              ))}
            </div>
          )}

          {hasScanned && matched.length === 0 && (
            <div className="py-12 text-center">
              <p className="font-heading text-sm uppercase tracking-widest text-outline">
                No cells found
              </p>
              <p className="mt-2 font-body text-xs text-on-surface-variant">
                No stealth Cells matched your keys.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
