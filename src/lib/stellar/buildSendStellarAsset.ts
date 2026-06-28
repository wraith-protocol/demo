import {
  decodeStealthMetaAddress,
  generateStealthAddress,
} from '@wraith-protocol/sdk/chains/stellar';
import type { StellarAssetInfo } from '@/lib/stellar/assets';

export interface BuildSendStellarAssetResult {
  stealthAddress: string;
  ephemeralPubKey: Uint8Array;
  viewTag: number;
  asset: StellarAssetInfo;
}

/**
 * Builds a stealth send payload for any Stellar asset (native XLM or issued assets like USDC).
 *
 * Decodes the recipient's meta-address, generates a one-time stealth address,
 * and returns the result alongside the asset info so the caller can construct
 * the appropriate Stellar transaction.
 */
export function buildSendStellarAsset(
  recipientMetaAddress: string,
  asset: StellarAssetInfo,
): BuildSendStellarAssetResult {
  const decoded = decodeStealthMetaAddress(recipientMetaAddress);
  const result = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);

  return {
    stealthAddress: result.stealthAddress,
    ephemeralPubKey: result.ephemeralPubKey,
    viewTag: result.viewTag,
    asset,
  };
}
