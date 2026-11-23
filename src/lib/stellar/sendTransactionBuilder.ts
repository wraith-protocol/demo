import {
  TransactionBuilder,
  Account,
  Asset,
  Operation,
  Memo,
  Contract,
  Address,
  nativeToScVal,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk';
import { decodeStealthMetaAddress } from '@wraith-protocol/sdk/chains/stellar';
import { STELLAR_ASSETS, type StellarAssetKey, getAssetByKey } from '@/lib/stellar/assets';

export const STELLAR_BASE_FEE_XLM = 0.00001;
export const STELLAR_BASE_RESERVE_XLM = 1;

export function getMinAmount(assetKey: StellarAssetKey): number {
  return assetKey === 'XLM' ? 0.0000001 : 0.0000001;
}

export function formatAsset(value: number, assetKey: StellarAssetKey): string {
  const assetInfo = getAssetByKey(assetKey);
  return value.toFixed(assetInfo.decimals).replace(/\.?0+$/, '');
}

export function validateMetaAddress(value: string): string {
  if (!value) return 'Recipient meta-address is required';
  if (!value.startsWith('st:xlm:')) return 'Not a valid Stellar stealth meta-address';

  try {
    decodeStealthMetaAddress(value);
    return '';
  } catch {
    return 'Not a valid Stellar stealth meta-address';
  }
}

export function validateAmount(value: string, assetKey: StellarAssetKey): string {
  if (!value) return 'Amount is required';
  if (!/^(?:\d+|\d*\.\d+)$/.test(value)) return `Enter a valid ${assetKey} amount`;

  const assetInfo = getAssetByKey(assetKey);
  const decimalPart = value.split('.')[1];
  if (decimalPart && decimalPart.length > assetInfo.decimals) {
    return `${assetKey} supports up to ${assetInfo.decimals} decimals`;
  }

  const parsed = Number(value);
  const minAmount = getMinAmount(assetKey);
  if (!Number.isFinite(parsed) || parsed <= minAmount) {
    return `Amount must be greater than ${minAmount} ${assetKey}`;
  }

  return '';
}

export interface BuildPaymentParams {
  sourceAccount: Account;
  destination: string;
  asset: Asset;
  amount: string;
  isNative: boolean;
  destinationExists: boolean;
  networkPassphrase: string;
  memo?: string;
  fee?: string;
  timeoutSeconds?: number;
}

export function buildPaymentTransaction(params: BuildPaymentParams): Transaction {
  const {
    sourceAccount,
    destination,
    asset,
    amount,
    isNative,
    destinationExists,
    networkPassphrase,
    memo,
    fee = '100',
    timeoutSeconds = 30,
  } = params;

  let builder = new TransactionBuilder(sourceAccount, { fee, networkPassphrase });

  if (destinationExists) {
    builder = builder.addOperation(
      Operation.payment({
        destination,
        asset,
        amount,
      }),
    );
  } else if (isNative) {
    builder = builder.addOperation(
      Operation.createAccount({
        destination,
        startingBalance: amount,
      }),
    );
  } else {
    builder = builder.addOperation(
      Operation.payment({
        destination,
        asset,
        amount,
      }),
    );
  }

  builder = builder.setTimeout(timeoutSeconds);

  if (memo) {
    builder = builder.addMemo(Memo.text(memo));
  }

  return builder.build();
}

export interface BuildAnnouncementParams {
  sourceAccount: Account;
  announcerContractId: string;
  schemeId: number;
  stealthAddress: string;
  ephemeralPubKey: Uint8Array;
  viewTag: number;
  networkPassphrase: string;
  fee?: string;
  timeoutSeconds?: number;
}

export function buildAnnouncementTransaction(params: BuildAnnouncementParams): Transaction {
  const {
    sourceAccount,
    announcerContractId,
    schemeId,
    stealthAddress,
    ephemeralPubKey,
    viewTag,
    networkPassphrase,
    fee = '100',
    timeoutSeconds = 30,
  } = params;

  const announcerContract = new Contract(announcerContractId);

  return new TransactionBuilder(sourceAccount, { fee, networkPassphrase })
    .addOperation(
      announcerContract.call(
        'announce',
        nativeToScVal(schemeId, { type: 'u32' }),
        new Address(stealthAddress).toScVal(),
        xdr.ScVal.scvBytes(Buffer.from(ephemeralPubKey)),
        xdr.ScVal.scvBytes(Buffer.from([viewTag])),
      ),
    )
    .setTimeout(timeoutSeconds)
    .build();
}
