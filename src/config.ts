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

export const STELLAR_NETWORK = {
  name: 'Stellar Testnet',
  networkPassphrase: 'Test SDF Network ; September 2015',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  explorerUrl: 'https://stellar.expert/explorer/testnet',
} as const;
