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
      <div className="flex items-start justify-between">
        <div>
          <span className="font-heading text-[10px] uppercase tracking-widest text-outline">
            Stealth Hash
          </span>
          <p className="truncate font-mono text-xs text-primary">{match.stealthPubKeyHash}</p>
        </div>
        <span className="font-heading text-lg font-bold text-on-surface">{capacityCkb} CKB</span>
      </div>

      <div>
        <span className="font-heading text-[10px] uppercase tracking-widest text-outline">
          Cell
        </span>
        <p className="truncate font-mono text-[11px] text-on-surface-variant">
          {match.txHash}:{match.index}
        </p>
      </div>

      <div className="border border-outline-variant bg-surface p-4">
        <p className="mb-2 font-heading text-[10px] uppercase tracking-widest text-outline">
          Withdraw
        </p>
        <p className="text-xs text-on-surface-variant">
          Use the private key below to sign a CKB transaction consuming this Cell.
        </p>
      </div>

      <div>
        {!showKey ? (
          <button
            onClick={() => setShowKey(true)}
            className="font-heading text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
          >
            Reveal private key
          </button>
        ) : (
          <div className="border border-error/20 bg-error/5 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-heading text-[9px] font-bold uppercase tracking-widest text-error">
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
      const signature = await signer.signMessage(STEALTH_SIGNING_MESSAGE);
      const sigHex = `0x${signature}` as HexString;
      const derived = deriveStealthKeys(sigHex);
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
      <section>
        <h1 className="mb-2 font-heading text-3xl font-bold uppercase tracking-tight text-primary">
          Receive
        </h1>
        <p className="mb-4 text-sm text-on-surface-variant">
          Connect your CKB wallet using the button in the header to scan for stealth payments.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="mb-1 font-heading text-3xl font-bold uppercase tracking-tight text-primary">
          Receive
        </h1>
        <p className="text-sm text-on-surface-variant">
          Derive your stealth keys, then scan for stealth Cells on CKB Testnet.
        </p>
      </div>

      {!ckbKeys && (
        <div className="flex flex-col gap-4">
          <button
            onClick={deriveKeys}
            disabled={isDerivingKeys}
            className="w-full bg-primary py-4 font-heading text-sm font-bold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {isDerivingKeys ? 'Sign in wallet...' : 'Derive Stealth Keys'}
          </button>
          {error && <p className="text-sm text-error">{error}</p>}
        </div>
      )}

      {ckbKeys && ckbMetaAddress && (
        <>
          <div className="border border-outline-variant bg-surface-container p-5">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-heading text-[10px] uppercase tracking-widest text-outline">
                Your Stealth Meta-Address
              </span>
              <CopyButton text={ckbMetaAddress} />
            </div>
            <code className="break-all font-mono text-xs text-primary">{ckbMetaAddress}</code>
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={scanPayments}
              disabled={isScanning}
              className="bg-primary px-6 py-3 font-heading text-sm font-bold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
            >
              {isScanning ? 'Scanning...' : 'Scan for Cells'}
            </button>
            {hasScanned && (
              <span className="font-heading text-xs text-on-surface-variant">
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
            <div className="py-12 text-center opacity-50">
              <p className="font-heading text-sm uppercase">No cells found</p>
              <p className="mt-1 text-xs text-on-surface-variant">
                No stealth Cells matched your keys.
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
