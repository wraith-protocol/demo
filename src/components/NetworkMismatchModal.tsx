import { useStellarWallet } from '@/context/StellarWalletContext';
import { STELLAR_NETWORK } from '@/config';

interface NetworkMismatchModalProps {
  onClose: () => void;
}

const NETWORK_LABELS: Record<string, string> = {
  PUBLIC: 'Mainnet',
  TESTNET: 'Testnet',
  FUTURENET: 'Futurenet',
};

export function NetworkMismatchModal({ onClose }: NetworkMismatchModalProps) {
  const { freighterNetwork } = useStellarWallet();

  const walletLabel = freighterNetwork
    ? (NETWORK_LABELS[freighterNetwork] ?? freighterNetwork)
    : 'an unknown network';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="mx-4 w-full max-w-lg border border-outline-variant bg-surface-container p-6">
        <h2 className="mb-1 font-heading text-lg font-bold uppercase tracking-tight text-on-surface">
          Network Mismatch
        </h2>
        <p className="mb-6 font-body text-xs text-on-surface-variant">
          Your wallet is connected to <span className="text-primary">{walletLabel}</span>, but this
          app runs on <span className="text-primary">{STELLAR_NETWORK.name}</span>. Open Freighter
          and switch its network to continue.
        </p>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 border border-outline-variant py-2 font-heading text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
          >
            OK, Got It
          </button>
        </div>
      </div>
    </div>
  );
}
