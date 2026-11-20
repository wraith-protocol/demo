import { defineChain } from 'viem';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { getStellarNetworkConfig } from '@/lib/stellar/deployments';

export const horizenTestnet = defineChain({
  id: 2651420,
  name: 'Horizen Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://horizen-testnet.rpc.caldera.xyz/http'] },
  },
  blockExplorers: {
    default: {
      name: 'Horizen Testnet Explorer',
      url: 'https://horizen-testnet.explorer.caldera.xyz',
    },
  },
  testnet: true,
});

export const wagmiConfig = getDefaultConfig({
  appName: 'Wraith Demo',
  projectId: import.meta.env.VITE_WC_PROJECT_ID || 'demo',
  chains: [horizenTestnet],
  transports: {
    [horizenTestnet.id]: http(),
  },
});

// The selected network and its endpoints come from
// `src/lib/stellar/deployments.ts`, the same table the contract IDs resolve
// from; `STELLAR_NETWORK` stays here so pages and contexts keep reading their
// endpoint config from `@/config`.
const stellarNetwork = getStellarNetworkConfig();

export const STELLAR_NETWORK = {
  name: stellarNetwork.label,
  networkPassphrase: stellarNetwork.networkPassphrase,
  rpcUrl: stellarNetwork.rpcUrl,
  horizonUrl: stellarNetwork.horizonUrl,
} as const;

// The stealth-vault contract has no fixed testnet deployment yet — operators
// configure it per environment once it ships (see wraith-protocol/contracts#48).
export const STELLAR_VAULT_CONTRACT_ID = import.meta.env.VITE_STELLAR_VAULT_CONTRACT_ID || '';

export const SOLANA_NETWORK = {
  name: 'Solana Devnet',
  rpcUrl: 'https://api.devnet.solana.com',
  explorerUrl: 'https://explorer.solana.com',
} as const;

export const CKB_NETWORK = {
  name: 'CKB Testnet',
  rpcUrl: 'https://testnet.ckb.dev/rpc',
  explorerUrl: 'https://pudge.explorer.nervos.org',
} as const;
