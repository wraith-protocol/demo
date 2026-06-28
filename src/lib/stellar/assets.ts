import { Asset } from '@stellar/stellar-sdk';

export interface StellarAssetInfo {
  code: string;
  issuer?: string;
  type: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
  label: string;
  decimals: number;
}

export const STELLAR_ASSETS: StellarAssetInfo[] = [
  {
    code: 'XLM',
    type: 'native',
    label: 'XLM',
    decimals: 7,
  },
  {
    code: 'USDC',
    issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NOATFQRAHX4WJ4A',
    type: 'credit_alphanum4',
    label: 'USDC',
    decimals: 7,
  },
];

export function getDefaultStellarAsset(): StellarAssetInfo {
  return STELLAR_ASSETS[0];
}

export function getStellarAssetByCode(code: string): StellarAssetInfo | undefined {
  return STELLAR_ASSETS.find((a) => a.code === code);
}

export function toStellarAsset(asset: StellarAssetInfo): Asset {
  if (asset.type === 'native') return Asset.native();
  return new Asset(asset.code, asset.issuer!);
}

export function getAssetBalance(
  balances: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
    balance: string;
  }>,
  asset: StellarAssetInfo,
): string {
  if (asset.type === 'native') {
    const entry = balances.find((b) => b.asset_type === 'native');
    return entry?.balance ?? '0';
  }
  const entry = balances.find(
    (b) => b.asset_code === asset.code && b.asset_issuer === asset.issuer,
  );
  return entry?.balance ?? '0';
}

export function hasTrustline(
  balances: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
    balance: string;
  }>,
  asset: StellarAssetInfo,
): boolean {
  if (asset.type === 'native') return true;
  return balances.some((b) => b.asset_code === asset.code && b.asset_issuer === asset.issuer);
}

export function validateAssetAmount(value: string, asset: StellarAssetInfo): string {
  if (!value) return 'Amount is required';
  if (!/^(?:\d+|\d*\.\d+)$/.test(value)) return `Enter a valid ${asset.label} amount`;

  const decimalPart = value.split('.')[1];
  if (decimalPart && decimalPart.length > asset.decimals) {
    return `${asset.label} supports up to ${asset.decimals} decimals`;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return `Amount must be greater than 0`;
  }

  return '';
}

export function formatAssetAmount(value: number | string, asset: StellarAssetInfo): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) return '0';
  return num.toFixed(asset.decimals).replace(/\.?0+$/, '');
}

export const STELLAR_USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NOATFQRAHX4WJ4A';
