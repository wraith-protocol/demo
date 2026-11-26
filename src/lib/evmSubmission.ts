import type { Hex, TransactionSerialized } from 'viem';
import {
  buildEvmSendIntent,
  IntentMismatchError,
  verifyEvmSignedTransaction,
  type TransactionIntent,
} from './txIntent';

export interface EvmReviewParams {
  chainId: number;
  account: Hex;
  to: Hex;
  data: Hex;
  value: bigint;
  stealthAddress: string;
  memo?: string;
}

export interface EvmSignRequest {
  account: Hex;
  chainId: number;
  to: Hex;
  data: Hex;
  value: bigint;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  nonce: number;
}

export interface EvmFeeClient {
  estimateGas(request: { account: Hex; to: Hex; data: Hex; value: bigint }): Promise<bigint>;
  estimateFeesPerGas(): Promise<{
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }>;
  getTransactionCount(request: { address: Hex; blockTag: 'pending' }): Promise<number>;
}

export interface EvmSigner {
  signTransaction(request: EvmSignRequest): Promise<TransactionSerialized>;
}

export interface EvmBroadcaster {
  sendRawTransaction(request: { serializedTransaction: TransactionSerialized }): Promise<Hex>;
}

/**
 * Freeze the gas limit, fee caps and nonce into the reviewed intent so that a
 * wallet substitution cannot change the cost of a transfer without changing
 * its fingerprint.
 */
export async function prepareEvmSend(
  client: EvmFeeClient,
  params: EvmReviewParams,
): Promise<{ intent: TransactionIntent; request: EvmSignRequest }> {
  const [gas, fees, nonce] = await Promise.all([
    client.estimateGas({
      account: params.account,
      to: params.to,
      data: params.data,
      value: params.value,
    }),
    client.estimateFeesPerGas(),
    client.getTransactionCount({ address: params.account, blockTag: 'pending' }),
  ]);

  if (!fees.maxFeePerGas || !fees.maxPriorityFeePerGas) {
    throw new Error('Fee estimates are unavailable, so the transfer cannot be verified.');
  }

  const request: EvmSignRequest = {
    account: params.account,
    chainId: params.chainId,
    to: params.to,
    data: params.data,
    value: params.value,
    gas,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    nonce,
  };

  const intent = buildEvmSendIntent({
    chainId: params.chainId,
    account: params.account,
    to: params.to,
    stealthAddress: params.stealthAddress,
    data: params.data,
    value: params.value,
    gas,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    nonce,
    memo: params.memo,
  });

  return { intent, request };
}

/**
 * Ask the wallet to sign, re-decode the result and reject anything that does
 * not match the reviewed intent before the raw transaction is broadcast. When
 * signing, decoding or verification is unavailable, nothing is submitted.
 */
export async function submitVerifiedEvmTransaction(
  signer: EvmSigner | undefined,
  broadcaster: EvmBroadcaster | undefined,
  intent: TransactionIntent,
  request: EvmSignRequest,
): Promise<Hex> {
  if (!signer || !broadcaster) {
    throw new Error('Transaction verification is unavailable. Nothing was submitted.');
  }

  const serialized = await signer.signTransaction(request);
  const verification = await verifyEvmSignedTransaction(intent, serialized);
  if (!verification.ok) {
    throw new IntentMismatchError(verification.mismatches);
  }

  return broadcaster.sendRawTransaction({ serializedTransaction: serialized });
}
