import { useStellarWallet } from '@/context/StellarWalletContext';

const NETWORK_LABELS: Record<string, string> = {
  PUBLIC: 'Mainnet',
  TESTNET: 'Testnet',
  FUTURENET: 'Futurenet',
};

export function NetworkChip() {
  const { isInstalled, isConnected, freighterNetwork, isNetworkMismatch } = useStellarWallet();

  // Nothing to show until Freighter is installed and connected
  if (!isInstalled || !isConnected) return null;

  const label = freighterNetwork ? (NETWORK_LABELS[freighterNetwork] ?? freighterNetwork) : '—';

  return (
    <span
      title={isNetworkMismatch ? 'Wallet network does not match app network' : undefined}
      className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
        isNetworkMismatch ? 'border-error text-error' : 'border-outline-variant text-outline'
      }`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          isNetworkMismatch ? 'bg-error' : 'bg-tertiary'
        }`}
      />
      {label}
    </span>
  );
}
