import { TransactionBuilder, Account, Operation, Asset, StrKey } from '@stellar/stellar-sdk';
import { signStellarTransaction } from '@wraith-protocol/sdk/chains/stellar';
import type { MatchedAnnouncement } from '@wraith-protocol/sdk/chains/stellar';
import { STELLAR_NETWORK } from '@/config';
import type { StellarAssetKey } from '@/lib/stellar/assets';
import { getAssetByKey } from '@/lib/stellar/assets';
import { fetchWithRetry } from '@/lib/stellar/retry';

/**
 * Item representing a stealth deposit selected for withdrawal.
 */
export interface BatchWithdrawItem {
  /** Matched announcement containing stealth address and private scalar */
  match: MatchedAnnouncement;
  /** Current balance for the selected asset */
  balance: string;
  /** Asset key (e.g. 'XLM', 'USDC') */
  assetKey: StellarAssetKey;
  /** Destination address override (optional, defaults to batch destination) */
  destination?: string;
}

/**
 * Validated entry ready for batch execution.
 */
export interface ValidatedWithdrawItem extends BatchWithdrawItem {
  resolvedDestination: string;
  sendableAmount: string;
}

/**
 * Entry that failed validation prior to transaction assembly.
 */
export interface InvalidWithdrawItem {
  item: BatchWithdrawItem;
  reason: string;
}

/**
 * Preview summary for a batch withdrawal operation.
 */
export interface BatchWithdrawPreview {
  validItems: ValidatedWithdrawItem[];
  invalidItems: InvalidWithdrawItem[];
  totalFeeStroops: string;
  totalFeeXLM: string;
  expectedWallClockSeconds: number;
  totalAmountXLM: string;
  isAtomic: boolean;
}

/**
 * Per-entry execution result after batch submission.
 */
export interface EntryExecutionResult {
  stealthAddress: string;
  success: boolean;
  error?: string;
  txHash?: string;
}

/**
 * Overall batch withdrawal execution result.
 */
export interface BatchWithdrawResult {
  success: boolean;
  txHash?: string;
  error?: string;
  entryResults: EntryExecutionResult[];
}

/**
 * Calculates total transaction fee in stroops and XLM for a given number of operations.
 */
export function calculateBatchFee(
  itemCount: number,
  baseFeeStroops = 100,
): {
  totalFeeStroops: string;
  totalFeeXLM: string;
} {
  const count = Math.max(1, itemCount);
  const stroops = count * baseFeeStroops;
  const xlm = (stroops / 10000000).toFixed(7);
  return {
    totalFeeStroops: stroops.toString(),
    totalFeeXLM: xlm,
  };
}

/**
 * Estimates wall-clock execution time in seconds for a batch of withdrawals.
 * Stellar ledger close time is ~5 seconds per transaction block.
 */
export function estimateBatchWallClock(itemCount: number): number {
  if (itemCount <= 0) return 0;
  // Up to 20 items execute in a single ledger block (~5s).
  // Larger batches split across multiple transactions scale linearly.
  const txCount = Math.ceil(itemCount / 20);
  return txCount * 5;
}

/**
 * Validates a list of stealth deposit withdrawal items before building the transaction.
 */
export function validateBatchWithdrawal(
  items: BatchWithdrawItem[],
  globalDestination?: string,
): BatchWithdrawPreview {
  const validItems: ValidatedWithdrawItem[] = [];
  const invalidItems: InvalidWithdrawItem[] = [];
  let totalAmount = 0;

  for (const item of items) {
    const dest = (item.destination || globalDestination || '').trim();

    if (!dest) {
      invalidItems.push({ item, reason: 'Missing destination address' });
      continue;
    }

    if (!StrKey.isValidEd25519PublicKey(dest)) {
      invalidItems.push({ item, reason: 'Invalid Stellar G... address format' });
      continue;
    }

    const numericBalance = parseFloat(item.balance || '0');
    if (isNaN(numericBalance) || numericBalance <= 0) {
      invalidItems.push({ item, reason: 'Zero or negative balance' });
      continue;
    }

    // Reserve calculation for XLM: 1 XLM base account reserve + fee
    let sendable = numericBalance;
    if (item.assetKey === 'XLM') {
      const reserve = 1.0; // Standard base reserve
      const estimatedFee = 0.00001;
      sendable = Math.max(0, numericBalance - reserve - estimatedFee);
      if (sendable <= 0) {
        invalidItems.push({
          item,
          reason: 'Balance too low to cover account reserve (1.0 XLM)',
        });
        continue;
      }
    }

    const sendableStr = sendable.toFixed(7);
    validItems.push({
      ...item,
      resolvedDestination: dest,
      sendableAmount: sendableStr,
    });
    totalAmount += sendable;
  }

  const { totalFeeStroops, totalFeeXLM } = calculateBatchFee(validItems.length);
  const expectedWallClockSeconds = estimateBatchWallClock(validItems.length);

  return {
    validItems,
    invalidItems,
    totalFeeStroops,
    totalFeeXLM,
    expectedWallClockSeconds,
    totalAmountXLM: totalAmount.toFixed(7),
    isAtomic: true,
  };
}

/**
 * Builds an atomic multi-operation batch withdrawal transaction.
 */
export async function buildBatchWithdrawTx(
  items: ValidatedWithdrawItem[],
  networkPassphrase = STELLAR_NETWORK.networkPassphrase,
): Promise<{
  txXdr: string;
  txHash: string;
  operationCount: number;
}> {
  if (items.length === 0) {
    throw new Error('Cannot build batch transaction with 0 valid items');
  }

  const primaryItem = items[0];
  const horizonUrl = STELLAR_NETWORK.horizonUrl;

  // Fetch sequence number for primary source account
  const res = await fetchWithRetry(`${horizonUrl}/accounts/${primaryItem.match.stealthAddress}`);
  if (!res.ok) {
    throw new Error(`Failed to load primary account: ${primaryItem.match.stealthAddress}`);
  }
  const primaryAccountData = await res.json();
  const sourceAccount = new Account(primaryItem.match.stealthAddress, primaryAccountData.sequence);

  const baseFee = (items.length * 100).toString();
  let builder = new TransactionBuilder(sourceAccount, {
    fee: baseFee,
    networkPassphrase,
  });

  for (const item of items) {
    if (item.assetKey === 'XLM') {
      builder = builder.addOperation(
        Operation.payment({
          source: item.match.stealthAddress,
          destination: item.resolvedDestination,
          asset: Asset.native(),
          amount: item.sendableAmount,
        }),
      );
    } else {
      const assetInfo = getAssetByKey(item.assetKey);
      builder = builder.addOperation(
        Operation.payment({
          source: item.match.stealthAddress,
          destination: item.resolvedDestination,
          asset: assetInfo.toAsset(),
          amount: item.sendableAmount,
        }),
      );
    }
  }

  builder = builder.setTimeout(60);
  const tx = builder.build();

  // Sign with each stealth key for operations requiring signature
  for (const item of items) {
    const txHash = tx.hash();
    const signature = signStellarTransaction(
      txHash,
      item.match.stealthPrivateScalar,
      item.match.stealthPubKeyBytes,
    );
    const signatureBase64 = Buffer.from(signature).toString('base64');
    tx.addSignature(item.match.stealthAddress, signatureBase64);
  }

  return {
    txXdr: tx.toXDR(),
    txHash: tx.hash().toString('hex'),
    operationCount: items.length,
  };
}

/**
 * Submits a batch withdrawal transaction and surfaces per-entry cause on failure.
 */
export async function submitBatchWithdrawal(
  txXdr: string,
  items: ValidatedWithdrawItem[],
  horizonUrl = STELLAR_NETWORK.horizonUrl,
): Promise<BatchWithdrawResult> {
  try {
    const submitRes = await fetch(`${horizonUrl}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `tx=${encodeURIComponent(txXdr)}`,
    });

    const submitData = await submitRes.json();

    if (!submitRes.ok) {
      const resultCodes = submitData.extras?.result_codes;
      const txCode = resultCodes?.transaction || submitData.title || 'Transaction failed';
      const opCodes: string[] = resultCodes?.operations || [];

      const entryResults: EntryExecutionResult[] = items.map((item, index) => {
        const opError = opCodes[index];
        const hasOpError = opError && opError !== 'op_success';
        return {
          stealthAddress: item.match.stealthAddress,
          success: false,
          error: hasOpError ? `Operation failed: ${opError}` : `Batch failed: ${txCode}`,
        };
      });

      return {
        success: false,
        error: txCode,
        entryResults,
      };
    }

    const txHash = submitData.hash;
    const entryResults: EntryExecutionResult[] = items.map((item) => ({
      stealthAddress: item.match.stealthAddress,
      success: true,
      txHash,
    }));

    return {
      success: true,
      txHash,
      entryResults,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Network error during batch submission';
    const entryResults: EntryExecutionResult[] = items.map((item) => ({
      stealthAddress: item.match.stealthAddress,
      success: false,
      error: errorMsg,
    }));

    return {
      success: false,
      error: errorMsg,
      entryResults,
    };
  }
}
