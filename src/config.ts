import { defineChain } from 'viem';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';

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

export const STELLAR_NETWORKS = {
  mainnet: {
    id: 'mainnet',
    freighterName: 'PUBLIC',
    name: 'Stellar Mainnet',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    rpcUrl: 'https://soroban-rpc.mainnet.stellar.gateway.fm',
    horizonUrl: 'https://horizon.stellar.org',
    explorerUrl: 'https://stellar.expert/explorer/public',
  },
  futurenet: {
    id: 'futurenet',
    freighterName: 'FUTURENET',
    name: 'Stellar Futurenet',
    networkPassphrase: 'Test SDF Future Network ; October 2022',
    rpcUrl: 'https://rpc-futurenet.stellar.org',
    horizonUrl: 'https://horizon-futurenet.stellar.org',
    explorerUrl: 'https://stellar.expert/explorer/futurenet',
  },
  testnet: {
    id: 'testnet',
    freighterName: 'TESTNET',
    name: 'Stellar Testnet',
    networkPassphrase: 'Test SDF Network ; September 2015',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    explorerUrl: 'https://stellar.expert/explorer/testnet',
  },
} as const;

export type StellarNetworkId = keyof typeof STELLAR_NETWORKS;
export type StellarNetwork = (typeof STELLAR_NETWORKS)[StellarNetworkId];

export const STELLAR_NETWORK = STELLAR_NETWORKS.testnet;

export function getStellarNetwork(network: string): StellarNetwork {
  const normalized = network.toUpperCase();
  if (normalized === 'PUBLIC' || normalized === 'MAINNET') return STELLAR_NETWORKS.mainnet;
  if (normalized === 'FUTURENET') return STELLAR_NETWORKS.futurenet;
  return STELLAR_NETWORKS.testnet;
}

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
