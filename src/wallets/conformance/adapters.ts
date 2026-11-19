import type { ConformanceChainSpec } from './harness';

/**
 * Chain-specific identity shapes and provider method names. Accounts are
 * representative addresses, not live wallets.
 */
export const CONFORMANCE_CHAINS: ConformanceChainSpec[] = [
  {
    chain: 'horizen',
    provider: 'rainbowkit:eip1193',
    account: '0x1111111111111111111111111111111111111111',
    nextAccount: '0x2222222222222222222222222222222222222222',
    network: 'horizen-testnet',
    nextNetwork: 'horizen-mainnet',
    requests: {
      simulate: 'eth_call',
      sign: 'personal_sign',
      scan: 'eth_getLogs',
      submit: 'eth_sendRawTransaction',
    },
  },
  {
    chain: 'stellar',
    provider: 'freighter',
    account: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    nextAccount: 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBH6',
    network: 'stellar-testnet',
    nextNetwork: 'stellar-mainnet',
    requests: {
      simulate: 'simulateTransaction',
      sign: 'signTransaction',
      scan: 'getEvents',
      submit: 'sendTransaction',
    },
  },
  {
    chain: 'solana',
    provider: 'phantom',
    account: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
    nextAccount: '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T',
    network: 'solana-devnet',
    nextNetwork: 'solana-mainnet',
    requests: {
      simulate: 'simulateTransaction',
      sign: 'signTransaction',
      scan: 'getSignaturesForAddress',
      submit: 'sendRawTransaction',
    },
  },
  {
    chain: 'ckb',
    provider: 'ccc',
    account: 'ckt1qyqwyxfa75whsshjumf8m7z8r6r0r6l4r0z3s9k',
    nextAccount: 'ckt1qyqdmeuqw8s9k7z8r6r0r6l4r0z3s9k5k4m8v',
    network: 'ckb-testnet',
    nextNetwork: 'ckb-mainnet',
    requests: {
      simulate: 'simulateTransaction',
      sign: 'signMessageRaw',
      scan: 'getCells',
      submit: 'sendTransaction',
    },
  },
];
