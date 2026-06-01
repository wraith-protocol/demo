import type { Chain } from '@/context/ChainContext';

export type NetworkStatus = 'correct' | 'wrong-network' | 'mainnet' | 'unknown' | 'disconnected';

export interface NetworkExpectation {
  chain: Chain;
  expectedNetwork: string;
  expectedChainId?: number;
  isTestnet: boolean;
  mainnetName: string;
  switchInstructions: string;
}

export const NETWORK_EXPECTATIONS: Record<Chain, NetworkExpectation> = {
  stellar: {
    chain: 'stellar',
    expectedNetwork: 'TESTNET',
    isTestnet: true,
    mainnetName: 'Public Global Stellar Network ; September 2015',
    switchInstructions:
      'Open Freighter → Settings → Network → select "Test Net".',
  },
  horizen: {
    chain: 'horizen',
    expectedNetwork: 'Horizen Testnet',
    expectedChainId: 2651420,
    isTestnet: true,
    mainnetName: 'Horizen Mainnet',
    switchInstructions:
      'Open MetaMask → click the network dropdown → select "Horizen Testnet". If not listed, add it with Chain ID 2651420.',
  },
  solana: {
    chain: 'solana',
    expectedNetwork: 'devnet',
    isTestnet: true,
    mainnetName: 'mainnet-beta',
    switchInstructions:
      'Open Phantom → Settings → Developer Settings → Change Network → select "Devnet".',
  },
  ckb: {
    chain: 'ckb',
    expectedNetwork: 'testnet',
    isTestnet: true,
    mainnetName: 'mainnet',
    switchInstructions:
      'Open your CKB wallet → Settings → Network → select "Testnet".',
  },
};

export function getStatusColor(status: NetworkStatus): string {
  switch (status) {
    case 'correct':
      return 'bg-green-500';
    case 'wrong-network':
      return 'bg-yellow-500';
    case 'mainnet':
      return 'bg-red-500';
    case 'unknown':
      return 'bg-red-500';
    case 'disconnected':
      return 'bg-outline';
  }
}

export function getStatusTextColor(status: NetworkStatus): string {
  switch (status) {
    case 'correct':
      return 'text-green-500';
    case 'wrong-network':
      return 'text-yellow-500';
    case 'mainnet':
      return 'text-red-500';
    case 'unknown':
      return 'text-red-500';
    case 'disconnected':
      return 'text-outline';
  }
}

export function getStatusLabel(status: NetworkStatus): string {
  switch (status) {
    case 'correct':
      return 'Connected';
    case 'wrong-network':
      return 'Wrong Network';
    case 'mainnet':
      return '⚠ MAINNET';
    case 'unknown':
      return 'Unknown';
    case 'disconnected':
      return 'Disconnected';
  }
}
