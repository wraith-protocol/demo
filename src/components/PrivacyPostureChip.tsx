import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { CopyButton } from './CopyButton';
import { CKB_NETWORK, SOLANA_NETWORK, STELLAR_NETWORK, horizenTestnet } from '@/config';
import { useChain } from '@/context/ChainContext';
import { getConsent, subscribeToConsent } from '@/lib/telemetry';
import { getPrivacyPosture, getRpcHost, type RpcRoute } from '@/lib/privacy-posture';

const RPC_ROUTES: RpcRoute[] = [
  {
    chain: 'horizen',
    label: 'Horizen',
    url: horizenTestnet.rpcUrls.default.http[0],
    defaultUrl: 'https://horizen-testnet.rpc.caldera.xyz/http',
  },
  {
    chain: 'stellar',
    label: 'Stellar RPC',
    url: STELLAR_NETWORK.rpcUrl,
    defaultUrl: 'https://soroban-testnet.stellar.org',
  },
  {
    chain: 'stellar',
    label: 'Stellar Horizon',
    url: STELLAR_NETWORK.horizonUrl,
    defaultUrl: 'https://horizon-testnet.stellar.org',
  },
  {
    chain: 'solana',
    label: 'Solana',
    url: SOLANA_NETWORK.rpcUrl,
    defaultUrl: 'https://api.devnet.solana.com',
  },
  {
    chain: 'ckb',
    label: 'CKB',
    url: CKB_NETWORK.rpcUrl,
    defaultUrl: 'https://testnet.ckb.dev/rpc',
  },
];

export function PrivacyPostureChip() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const detailsId = useId();
  const { chain } = useChain();
  const consent = useSyncExternalStore(subscribeToConsent, getConsent, () => null);
  const posture = getPrivacyPosture(consent === 'accepted', RPC_ROUTES, chain);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={detailsId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1.5 border border-outline-variant px-2 py-0.5 font-mono text-[9px] tracking-wider text-on-surface transition-colors hover:border-outline"
      >
        <span
          aria-hidden="true"
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            posture === 'strict' ? 'bg-tertiary' : 'bg-outline'
          }`}
        />
        Privacy: {posture}
      </button>

      {open && (
        <div
          id={detailsId}
          role="dialog"
          aria-label="Privacy infrastructure posture"
          className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] border border-outline-variant bg-surface-container p-4 shadow-lg"
        >
          <div className="flex items-center justify-between gap-4 border-b border-outline-variant/40 pb-3">
            <div>
              <p className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface">
                Infrastructure privacy
              </p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">
                Telemetry: {consent === 'accepted' ? 'on' : 'off'}
              </p>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface">
              {posture}
            </span>
          </div>

          <div className="mt-3 space-y-3">
            {RPC_ROUTES.map((route) => {
              const host = getRpcHost(route.url);
              return (
                <div
                  key={route.label ?? route.chain}
                  className="flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-heading text-[10px] uppercase tracking-wider text-on-surface-variant">
                      {route.label ?? route.chain}
                    </p>
                    <p className="truncate font-mono text-[11px] text-on-surface" title={host}>
                      {host}
                    </p>
                  </div>
                  <CopyButton text={host} />
                </div>
              );
            })}
          </div>

          <div className="mt-4 border-t border-outline-variant/40 pt-3">
            <Link
              to="/privacy"
              onClick={() => setOpen(false)}
              className="font-mono text-[10px] uppercase tracking-widest text-primary underline underline-offset-2"
            >
              Review privacy settings
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
