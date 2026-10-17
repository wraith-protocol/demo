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

interface HorizonAccountResponse {
  sequence: string;
  balances?: Array<{
    asset_type?: string;
    asset_code?: string;
    asset_issuer?: string;
  }>;
}

async function fetchHorizonAccount(
  address: string,
): Promise<HorizonAccountResponse | null> {
  const res = await fetch(`${STELLAR_NETWORK.horizonUrl}/accounts/${address}`);
  if (!res.ok) return null;
  return (await res.json()) as HorizonAccountResponse;
}

export async function buildSendStellarAsset(
  params: BuildSendStellarAssetParams,
): Promise<BuildSendStellarAssetResult> {
  const { senderAddress, recipientMetaAddress, amount, assetKey, memo } = params;

  const assetInfo = getAssetByKey(assetKey);
  const asset = assetInfo.toAsset();
  const decoded = decodeStealthMetaAddress(recipientMetaAddress);
  const result = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
  const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

  const accountData = await fetchHorizonAccount(senderAddress);
  if (!accountData) throw new Error('Failed to load sender account');
  const sourceAccount = new Account(senderAddress, accountData.sequence);

  let stealthExists = false;
  try {
    const stealthAccount = await fetchHorizonAccount(result.stealthAddress);
    stealthExists = stealthAccount !== null;
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
  if (assetKey === 'XLM') {
    return true;
  }

  const assetInfo = getAssetByKey(assetKey);
  try {
    const data = await fetchHorizonAccount(address);
    if (!data) return true;
    const balances = data.balances || [];
    const issuer = assetInfo.toAsset().getIssuer();
    return balances.some(
      (b) => b.asset_code === assetInfo.key && b.asset_issuer === issuer,
    );
  } catch {
    return true;
  }
}
