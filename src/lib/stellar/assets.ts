import { Asset } from '@stellar/stellar-sdk';

export const STELLAR_USDC = {
  code: 'USDC',
  issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NOATFQRAHX4JHPX',
} as const;

export const STELLAR_ASSETS = [
  {
    key: 'XLM',
    label: 'XLM',
    decimals: 7,
    isNative: true,
    toAsset: () => Asset.native(),
  },
  {
    key: 'USDC',
    label: 'USDC',
    decimals: 7,
    isNative: false,
    toAsset: () => new Asset(STELLAR_USDC.code, STELLAR_USDC.issuer),
  },
] as const;

export type StellarAssetKey = (typeof STELLAR_ASSETS)[number]['key'];

export function getAssetByKey(key: StellarAssetKey): (typeof STELLAR_ASSETS)[number] {
  const asset = STELLAR_ASSETS.find((a) => a.key === key);
  if (!asset) throw new Error(`Unknown Stellar asset: ${key}`);
  return asset;
}

export interface HorizonBalanceEntry {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
}

export function parseAssetBalances(
  balances: HorizonBalanceEntry[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const b of balances) {
    if (b.asset_type === 'native') {
      map['XLM'] = b.balance;
    } else if (b.asset_code && b.asset_issuer) {
      map[`${b.asset_code}:${b.asset_issuer}`] = b.balance;
    }
  }
  return map;
}

export function formatStellarAssetAmount(value: string, decimals: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return num.toFixed(decimals).replace(/\.?0+$/, '');
}

export function displayAssetBalances(
  balances: Record<string, string>,
): Array<{ key: string; balance: string; asset: (typeof STELLAR_ASSETS)[number] }> {
  return STELLAR_ASSETS.map((asset) => {
    let balanceKey: string;
    if (asset.isNative) {
      balanceKey = 'XLM';
    } else {
      balanceKey = `${asset.key}:${STELLAR_USDC.issuer}`;
    }
    const bal = balances[balanceKey] || '0';
    return { key: asset.key, balance: formatStellarAssetAmount(bal, asset.decimals), asset };
  }).filter((item) => parseFloat(item.balance) > 0 || item.key === 'XLM');
}
