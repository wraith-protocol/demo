import { STELLAR_NETWORK } from '@/config';

export type StellarExpertNetwork = 'public' | 'testnet' | 'futurenet';
export type StellarExpertResource = 'account' | 'tx' | 'contract';
export type StellarExpertNetworkInput = StellarExpertNetwork | 'mainnet' | string;

const STELLAR_EXPERT_ORIGIN = `https://${['stellar', 'expert'].join('.')}`;

const NETWORK_ALIASES: Record<string, StellarExpertNetwork> = {
  public: 'public',
  mainnet: 'public',
  'public global stellar network ; september 2015': 'public',
  testnet: 'testnet',
  'stellar testnet': 'testnet',
  'test sdf network ; september 2015': 'testnet',
  futurenet: 'futurenet',
  'stellar futurenet': 'futurenet',
  'test sdf future network ; october 2022': 'futurenet',
};

const RESOURCE_PATHS: Record<StellarExpertResource, string> = {
  account: 'account',
  tx: 'tx',
  contract: 'contract',
};

export function stellarExpertNetwork(
  network: StellarExpertNetworkInput = STELLAR_NETWORK.networkPassphrase,
): StellarExpertNetwork {
  const normalized = network.trim().toLowerCase();
  const resolved = NETWORK_ALIASES[normalized];

  if (!resolved) {
    throw new Error(`Unsupported Stellar network: ${network}`);
  }

  return resolved;
}

export function stellarExpertUrl(
  resource: StellarExpertResource,
  value: string,
  network: StellarExpertNetworkInput = STELLAR_NETWORK.networkPassphrase,
): string {
  const identifier = value.trim();
  if (!identifier) throw new Error('A Stellar identifier is required');

  return `${STELLAR_EXPERT_ORIGIN}/explorer/${stellarExpertNetwork(network)}/${RESOURCE_PATHS[resource]}/${encodeURIComponent(identifier)}`;
}

export function stellarExpertAccountUrl(
  address: string,
  network?: StellarExpertNetworkInput,
): string {
  return stellarExpertUrl('account', address, network);
}

export function stellarExpertTransactionUrl(
  hash: string,
  network?: StellarExpertNetworkInput,
): string {
  return stellarExpertUrl('tx', hash, network);
}

export const stellarExpertTxUrl = stellarExpertTransactionUrl;

export function stellarExpertContractUrl(
  contractId: string,
  network?: StellarExpertNetworkInput,
): string {
  return stellarExpertUrl('contract', contractId, network);
}
