import { TransactionBuilder, Account, Operation, Asset, Memo } from '@stellar/stellar-sdk';
import {
  generateStealthAddress,
  decodeStealthMetaAddress,
} from '@wraith-protocol/sdk/chains/stellar';
import { STELLAR_NETWORK } from '@/config';
import type { StellarAssetKey } from '@/lib/stellar/assets';
import { getAssetByKey } from '@/lib/stellar/assets';

export interface BuildSendStellarAssetParams {
  senderAddress: string;
  recipientMetaAddress: string;
  amount: string;
  assetKey: StellarAssetKey;
  memo?: string;
}

export interface BuildSendStellarAssetResult {
  stealthAddress: string;
  ephemeralPubKey: Uint8Array;
  viewTag: number;
  transactionXdr: string;
  txHashHex: string;
}

export async function buildSendStellarAsset(
  params: BuildSendStellarAssetParams,
): Promise<BuildSendStellarAssetResult> {
  const { senderAddress, recipientMetaAddress, amount, assetKey, memo } = params;

  const assetInfo = getAssetByKey(assetKey);
  const asset = assetInfo.toAsset();
  const decoded = decodeStealthMetaAddress(recipientMetaAddress);
  const result = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
  const horizonUrl = STELLAR_NETWORK.horizonUrl;
  const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

  const accountRes = await fetch(`${horizonUrl}/accounts/${senderAddress}`);
  if (!accountRes.ok) throw new Error('Failed to load sender account');
  const accountData = await accountRes.json();
  const sourceAccount = new Account(senderAddress, accountData.sequence);

  let stealthExists = false;
  try {
    const stealthCheckRes = await fetch(`${horizonUrl}/accounts/${result.stealthAddress}`);
    stealthExists = stealthCheckRes.ok;
  } catch {
    // Transient — assume not created yet
  }

  let builder = new TransactionBuilder(sourceAccount, {
    fee: '100',
    networkPassphrase,
  });

  if (stealthExists) {
    if (assetInfo.isNative) {
      builder = builder.addOperation(
        Operation.payment({
          destination: result.stealthAddress,
          asset: Asset.native(),
          amount,
        }),
      );
    } else {
      builder = builder.addOperation(
        Operation.payment({
          destination: result.stealthAddress,
          asset,
          amount,
        }),
      );
    }
  } else {
    if (assetInfo.isNative) {
      builder = builder.addOperation(
        Operation.createAccount({
          destination: result.stealthAddress,
          startingBalance: amount,
        }),
      );
    } else {
      builder = builder.addOperation(
        Operation.payment({
          destination: result.stealthAddress,
          asset,
          amount,
        }),
      );
    }
  }

  builder = builder.setTimeout(30);

  if (memo) {
    builder = builder.addMemo(Memo.text(memo));
  }

  const classicTx = builder.build();
  const txHashHex = classicTx.hash().toString('hex');

  return {
    stealthAddress: result.stealthAddress,
    ephemeralPubKey: result.ephemeralPubKey,
    viewTag: result.viewTag,
    transactionXdr: classicTx.toXDR(),
    txHashHex,
  };
}

export async function checkAssetTrustline(
  address: string,
  assetKey: StellarAssetKey,
): Promise<boolean> {
  if (assetKey === 'XLM') return true;

  const assetInfo = getAssetByKey(assetKey);
  try {
    const res = await fetch(`${STELLAR_NETWORK.horizonUrl}/accounts/${address}`);
    if (!res.ok) return true;
    const data = await res.json();
    const balances = data.balances || [];
    return balances.some(
      (b: { asset_type?: string; asset_code?: string; asset_issuer?: string }) =>
        b.asset_code === assetInfo.key &&
        b.asset_issuer === (assetInfo.toAsset() as any).getIssuer(),
    );
  } catch {
    return true;
  }
}
