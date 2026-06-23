import { Asset, TransactionBuilder, Account, Operation, Transaction } from '@stellar/stellar-sdk';
import { STELLAR_NETWORK } from '@/config';

export interface StellarAssetConfig {
  code: string;
  issuer?: string;
  isNative: boolean;
  label: string;
}

export const STELLAR_ASSETS: Record<string, StellarAssetConfig> = {
  XLM: { code: 'XLM', isNative: true, label: 'XLM' },
  USDC: {
    code: 'USDC',
    issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    isNative: false,
    label: 'USDC',
  },
};

export type StellarAssetKey = keyof typeof STELLAR_ASSETS;

export const ASSET_KEYS = Object.keys(STELLAR_ASSETS) as StellarAssetKey[];

export function toStellarSdkAsset(assetKey: StellarAssetKey): Asset {
  const config = STELLAR_ASSETS[assetKey];
  if (config.isNative) return Asset.native();
  return new Asset(config.code, config.issuer!);
}

export interface TrustlineStatus {
  hasTrustline: boolean;
  balance: string;
}

export async function checkTrustline(
  address: string,
  assetKey: StellarAssetKey,
): Promise<TrustlineStatus> {
  if (assetKey === 'XLM') {
    return { hasTrustline: true, balance: '0' };
  }

  const config = STELLAR_ASSETS[assetKey];
  const res = await fetch(`${STELLAR_NETWORK.horizonUrl}/accounts/${address}`);
  if (!res.ok) {
    return { hasTrustline: false, balance: '0' };
  }

  const data = await res.json();
  const balance = data.balances?.find(
    (b: { asset_code?: string; asset_issuer?: string }) =>
      b.asset_code === config.code && b.asset_issuer === config.issuer,
  );

  return {
    hasTrustline: !!balance,
    balance: balance?.balance ?? '0',
  };
}

export async function checkAccountExists(address: string): Promise<boolean> {
  const res = await fetch(`${STELLAR_NETWORK.horizonUrl}/accounts/${address}`);
  return res.ok;
}

export interface AccountBalances {
  xlm: string;
  usdc: string;
}

export async function fetchAccountBalances(address: string): Promise<AccountBalances> {
  const res = await fetch(`${STELLAR_NETWORK.horizonUrl}/accounts/${address}`);
  if (!res.ok) {
    return { xlm: '0', usdc: '0' };
  }

  const data = await res.json();
  const xlm = data.balances?.find((b: { asset_type: string }) => b.asset_type === 'native');
  const usdcConfig = STELLAR_ASSETS.USDC;
  const usdc = data.balances?.find(
    (b: { asset_code?: string; asset_issuer?: string }) =>
      b.asset_code === usdcConfig.code && b.asset_issuer === usdcConfig.issuer,
  );

  return {
    xlm: xlm?.balance ?? '0',
    usdc: usdc?.balance ?? '0',
  };
}

function computeSendableXlm(
  xlmBalance: string,
  subentryCount: number,
): { sendable: string; error: string | null } {
  const reserve = (2 + subentryCount) * 0.5;
  const sendable = (parseFloat(xlmBalance) - reserve - 0.00001).toFixed(7);
  if (parseFloat(sendable) <= 0) {
    return { sendable: '0', error: 'Balance too low to cover reserve' };
  }
  return { sendable, error: null };
}

export function buildPaymentTx(options: {
  sourceAddress: string;
  sequence: string;
  destination: string;
  amount: string;
  assetKey: StellarAssetKey;
  networkPassphrase: string;
  fee?: string;
}): Transaction {
  const { sourceAddress, sequence, destination, amount, assetKey, networkPassphrase, fee } =
    options;
  const sdkAsset = toStellarSdkAsset(assetKey);

  return new TransactionBuilder(new Account(sourceAddress, sequence), {
    fee: fee ?? '100',
    networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: sdkAsset,
        amount,
      }),
    )
    .setTimeout(30)
    .build();
}

export function buildCreateAccountTx(options: {
  sourceAddress: string;
  sequence: string;
  destination: string;
  startingBalance: string;
  networkPassphrase: string;
}): Transaction {
  const { sourceAddress, sequence, destination, startingBalance, networkPassphrase } = options;
  return new TransactionBuilder(new Account(sourceAddress, sequence), {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(
      Operation.createAccount({
        destination,
        startingBalance,
      }),
    )
    .setTimeout(30)
    .build();
}

export function trustlineLaboratoryUrl(assetKey: StellarAssetKey): string {
  const config = STELLAR_ASSETS[assetKey];
  if (config.isNative) return '';
  return `https://laboratory.stellar.org/#?network=testnet&operation=changeTrust&assetCode=${config.code}&assetIssuer=${config.issuer}`;
}

export function computeSendableXlmAmount(
  xlmBalance: string,
  subentryCount: number,
): { sendable: string; error: string | null } {
  return computeSendableXlm(xlmBalance, subentryCount);
}
