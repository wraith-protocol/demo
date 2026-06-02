import type { ReactNode } from 'react';
import { stellarTxUrl } from '@/lib/explorer';
import { CopyButton } from '@/components/CopyButton';
import { StellarPaymentLink } from '@/components/StellarPaymentLink';

export interface StellarReceiveViewProps {
  isConnected: boolean;
  isDerivingKeys: boolean;
  keysDerived: boolean;
  metaAddress: string | null;
  registered: boolean;
  isRegistering: boolean;
  regHash: string | null;
  isScanning: boolean;
  hasScanned: boolean;
  matchCount: number;
  matches: ReactNode;
  error: string;
  onDeriveKeys: () => void;
  onRegister: () => void;
  onScan: () => void;
}

export function StellarReceiveView({
  isConnected,
  isDerivingKeys,
  keysDerived,
  metaAddress,
  registered,
  isRegistering,
  regHash,
  isScanning,
  hasScanned,
  matchCount,
  matches,
  error,
  onDeriveKeys,
  onRegister,
  onScan,
}: StellarReceiveViewProps) {
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

      {!keysDerived && (
        <div className="flex flex-col gap-4">
          <button
            onClick={onDeriveKeys}
            disabled={isDerivingKeys}
            className="h-12 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {isDerivingKeys ? 'Sign in wallet...' : 'Derive Keys'}
          </button>
          {error && <p className="text-sm text-error">{error}</p>}
        </div>
      )}

      {keysDerived && metaAddress && (
        <>
          <div className="border border-outline-variant bg-surface-container p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Your Stealth Meta-Address
              </span>
              <CopyButton text={metaAddress} />
            </div>
            <code className="block break-all font-mono text-xs leading-relaxed text-primary">
              {metaAddress}
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
                  onClick={onRegister}
                  disabled={isRegistering}
                  className="h-11 w-full border border-outline-variant font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-30"
                >
                  {isRegistering ? 'Registering...' : 'Register On-Chain'}
                </button>
              </div>
            )}
          </div>

          <StellarPaymentLink metaAddress={metaAddress} />

          <div className="flex items-center justify-between">
            <button
              onClick={onScan}
              disabled={isScanning}
              className="h-12 bg-primary px-6 font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
            >
              {isScanning ? 'Scanning...' : 'Scan for Payments'}
            </button>
            {hasScanned && (
              <span className="font-mono text-xs text-on-surface-variant">
                {matchCount} transfer{matchCount !== 1 ? 's' : ''} found
              </span>
            )}
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          {matchCount > 0 && <div className="flex flex-col gap-4">{matches}</div>}

          {hasScanned && matchCount === 0 && (
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
