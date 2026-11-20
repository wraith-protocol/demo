import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import {
  Memo,
  Transaction,
  TransactionBuilder,
  type Asset,
  type Operation,
} from '@stellar/stellar-sdk';
import type { Transaction as SolanaTransaction } from '@solana/web3.js';

export type IntentChain = 'horizen' | 'stellar' | 'solana' | 'ckb';

export interface ContractCall {
  address: string;
  method: string;
  args: string[];
}

/**
 * Every value that a wallet signature authorizes. Two intents with the same
 * fingerprint have identical chain, network, account, recipient, asset,
 * amount, fee, memo, contract call, and chain-specific extras.
 */
export interface TransactionIntent {
  chain: IntentChain;
  network: string;
  account: string;
  recipient: string;
  asset: string;
  /** Canonical base-unit amount (wei, stroops, lamports, shannons). */
  amount: string;
  /** Canonical base-unit fee committed by the signed payload. */
  fee: string;
  memo: string | null;
  contract: ContractCall | null;
  /** Additional signed context such as sequence, blockhash, or lock args. */
  extra: Record<string, string>;
}

export interface IntentMismatch {
  field: string;
  expected: string;
  actual: string;
}

export interface IntentVerification {
  ok: boolean;
  expectedHash: string;
  actualHash: string;
  mismatches: IntentMismatch[];
}

export class IntentMismatchError extends Error {
  constructor(public readonly mismatches: IntentMismatch[]) {
    super(
      `Transaction does not match the confirmed intent (${mismatches
        .map((mismatch) => mismatch.field)
        .join(', ')}). Nothing was submitted.`,
    );
    this.name = 'IntentMismatchError';
  }
}

const FIELD_ORDER: Array<keyof TransactionIntent> = [
  'chain',
  'network',
  'account',
  'recipient',
  'asset',
  'amount',
  'fee',
  'memo',
  'contract',
  'extra',
];

const INTENT_DOMAIN = 'wraith-intent/v1';

function canonicalContract(contract: ContractCall | null) {
  if (!contract) return null;
  return {
    address: contract.address,
    method: contract.method,
    args: contract.args,
  };
}

function canonicalExtra(extra: Record<string, string>) {
  return Object.keys(extra)
    .sort()
    .reduce<Record<string, string>>((accumulator, key) => {
      accumulator[key] = String(extra[key]);
      return accumulator;
    }, {});
}

export function canonicalizeIntent(intent: TransactionIntent) {
  const canonical: Record<string, unknown> = {};
  for (const field of FIELD_ORDER) {
    if (field === 'contract') {
      canonical[field] = canonicalContract(intent.contract);
    } else if (field === 'extra') {
      canonical[field] = canonicalExtra(intent.extra);
    } else {
      canonical[field] = intent[field];
    }
  }
  return JSON.stringify(canonical);
}

export function fingerprintIntent(intent: TransactionIntent) {
  const digest = sha256(new TextEncoder().encode(`${INTENT_DOMAIN}|${canonicalizeIntent(intent)}`));
  return `0x${bytesToHex(digest)}`;
}

export interface WalletContext {
  chain: IntentChain;
  network: string;
  account: string;
}

export function walletContextFromIntent(intent: TransactionIntent): WalletContext {
  return { chain: intent.chain, network: intent.network, account: intent.account };
}

export function fingerprintWalletContext(context: WalletContext) {
  return fingerprintIntent({
    chain: context.chain,
    network: context.network,
    account: context.account,
    recipient: '',
    asset: '',
    amount: '',
    fee: '',
    memo: null,
    contract: null,
    extra: {},
  });
}

/**
 * A simulation is only valid for the exact intent and wallet context that
 * produced it. Any signed field, account, or network change yields a new
 * fingerprint, so the old simulation can no longer authorize a send.
 */
export interface SimulationBinding<T> {
  intentHash: string;
  walletHash: string;
  simulatedAt: number;
  result: T;
}

export function bindSimulation<T>(
  intent: TransactionIntent,
  result: T,
  simulatedAt = Date.now(),
): SimulationBinding<T> {
  return {
    intentHash: fingerprintIntent(intent),
    walletHash: fingerprintWalletContext(walletContextFromIntent(intent)),
    simulatedAt,
    result,
  };
}

export function simulationIsFresh<T>(
  binding: SimulationBinding<T> | null | undefined,
  intent: TransactionIntent,
) {
  if (!binding) return false;
  return (
    binding.intentHash === fingerprintIntent(intent) &&
    binding.walletHash === fingerprintWalletContext(walletContextFromIntent(intent))
  );
}

function fieldValue(field: keyof TransactionIntent, intent: TransactionIntent) {
  if (field === 'contract') return JSON.stringify(canonicalContract(intent.contract));
  if (field === 'extra') return JSON.stringify(canonicalExtra(intent.extra));
  return JSON.stringify(intent[field]);
}

export function diffIntents(
  expected: TransactionIntent,
  actual: TransactionIntent,
): IntentMismatch[] {
  const mismatches: IntentMismatch[] = [];

  for (const field of FIELD_ORDER) {
    const expectedValue = fieldValue(field, expected);
    const actualValue = fieldValue(field, actual);
    if (expectedValue !== actualValue) {
      mismatches.push({ field, expected: expectedValue, actual: actualValue });
    }
  }

  return mismatches;
}

export function verifyIntent(
  expected: TransactionIntent,
  actual: TransactionIntent,
): IntentVerification {
  const mismatches = diffIntents(expected, actual);
  return {
    ok: mismatches.length === 0,
    expectedHash: fingerprintIntent(expected),
    actualHash: fingerprintIntent(actual),
    mismatches,
  };
}

export function assertIntentMatches(expected: TransactionIntent, actual: TransactionIntent): void {
  const verification = verifyIntent(expected, actual);
  if (!verification.ok) {
    throw new IntentMismatchError(verification.mismatches);
  }
}

export interface IntentFieldDescription {
  label: string;
  value: string;
}

export function describeIntent(intent: TransactionIntent): IntentFieldDescription[] {
  const fields: IntentFieldDescription[] = [
    { label: 'Network', value: `${intent.chain} · ${intent.network}` },
    { label: 'Account', value: intent.account },
    { label: 'Recipient', value: intent.recipient },
    { label: 'Asset', value: intent.asset },
    { label: 'Amount', value: intent.amount },
    { label: 'Fee', value: intent.fee },
    { label: 'Memo', value: intent.memo ?? 'None' },
  ];

  if (intent.contract) {
    fields.push({
      label: 'Contract',
      value: `${intent.contract.address}.${intent.contract.method}(${intent.contract.args.join(
        ', ',
      )})`,
    });
  }

  for (const key of Object.keys(intent.extra).sort()) {
    fields.push({ label: key, value: intent.extra[key] });
  }

  fields.push({ label: 'Intent fingerprint', value: fingerprintIntent(intent) });

  return fields;
}

/* -------------------------------------------------------------------------- */
/* Stellar                                                                    */
/* -------------------------------------------------------------------------- */

export interface StellarSendIntentParams {
  address: string;
  metaAddress: string;
  stealthAddress: string;
  amount: string;
  asset: string;
  memo?: string;
  sequence: string;
  operation: 'createAccount' | 'payment';
  announcerContract: string;
  schemeId: string;
  ephemeralPubKey: string;
  viewTag: number;
  networkPassphrase: string;
  fee?: string;
}

export function buildStellarSendIntent(params: StellarSendIntentParams): TransactionIntent {
  return {
    chain: 'stellar',
    network: params.networkPassphrase,
    account: params.address,
    recipient: params.stealthAddress,
    asset: params.asset,
    amount: params.amount,
    fee: params.fee ?? '100',
    memo: params.memo?.trim() ? params.memo.trim() : null,
    contract: {
      address: params.announcerContract,
      method: 'announce',
      args: [
        `schemeId=${params.schemeId}`,
        `stealthAddress=${params.stealthAddress}`,
        `ephemeralPubKey=${params.ephemeralPubKey}`,
        `viewTag=${params.viewTag}`,
      ],
    },
    extra: {
      operation: params.operation,
      sequence: params.sequence,
      metaAddress: params.metaAddress,
      ephemeralPubKey: params.ephemeralPubKey,
      viewTag: String(params.viewTag),
    },
  };
}

function normalizeDecimal(value: string) {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return value;
  const [wholePart, fractionPart = ''] = value.split('.');
  const whole = wholePart.replace(/^0+(?=\d)/, '');
  const fraction = fractionPart.replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function operationAssetKey(asset: Asset) {
  return asset.isNative() ? 'XLM' : asset.getCode();
}

function memoText(memo: Memo) {
  if (memo.type === 'none' || memo.value === null || memo.value === undefined) return null;
  if (memo.type === 'text') return memo.value.toString();
  return Buffer.from(memo.value as Buffer).toString('hex');
}

function operationMatchesIntent(
  operation: Operation,
  intent: TransactionIntent,
  mismatches: IntentMismatch[],
) {
  const destination = 'destination' in operation ? String(operation.destination) : '';
  const amount = 'amount' in operation ? String(operation.amount) : '';
  const operationAsset = 'asset' in operation ? operation.asset : undefined;
  const asset =
    operationAsset && typeof (operationAsset as Asset).isNative === 'function'
      ? operationAssetKey(operationAsset as Asset)
      : '';

  if (destination !== intent.recipient) {
    mismatches.push({
      field: 'recipient',
      expected: intent.recipient,
      actual: destination || '(none)',
    });
  }

  if (normalizeDecimal(amount) !== normalizeDecimal(intent.amount)) {
    mismatches.push({ field: 'amount', expected: intent.amount, actual: amount || '(none)' });
  }

  if (asset && asset !== intent.asset) {
    mismatches.push({ field: 'asset', expected: intent.asset, actual: asset });
  }

  const expectedOperation = intent.extra.operation;
  if (expectedOperation && operation.type !== expectedOperation) {
    mismatches.push({
      field: 'operation',
      expected: expectedOperation,
      actual: operation.type,
    });
  }
}

export function verifyStellarTransactionIntent(
  transaction: Transaction,
  intent: TransactionIntent,
): IntentVerification {
  const mismatches: IntentMismatch[] = [];

  if (transaction.source !== intent.account) {
    mismatches.push({
      field: 'account',
      expected: intent.account,
      actual: transaction.source,
    });
  }

  const fee = String(transaction.fee);
  if (fee !== intent.fee) {
    mismatches.push({ field: 'fee', expected: intent.fee, actual: fee });
  }

  if (memoText(transaction.memo) !== intent.memo) {
    mismatches.push({
      field: 'memo',
      expected: intent.memo ?? 'None',
      actual: memoText(transaction.memo) ?? 'None',
    });
  }

  if (transaction.operations.length !== 1) {
    mismatches.push({
      field: 'operations',
      expected: '1',
      actual: String(transaction.operations.length),
    });
  } else {
    operationMatchesIntent(transaction.operations[0], intent, mismatches);
  }

  return {
    ok: mismatches.length === 0,
    expectedHash: fingerprintIntent(intent),
    actualHash: fingerprintIntent(intent),
    mismatches,
  };
}

export function assertStellarTransactionIntent(
  transaction: Transaction,
  intent: TransactionIntent,
): void {
  const verification = verifyStellarTransactionIntent(transaction, intent);
  if (!verification.ok) {
    throw new IntentMismatchError(verification.mismatches);
  }
}

/**
 * Re-decodes the wallet's signed envelope and requires it to authorize exactly
 * the transaction that was simulated and confirmed. A wallet that swaps the
 * destination, amount, asset, fee, memo, source account, or sequence produces a
 * different hash and is rejected before submission.
 */
export function verifyStellarSignedTransaction(
  expected: Transaction,
  signedXdr: string,
  networkPassphrase: string,
): IntentVerification {
  let signed: Transaction;
  try {
    signed = TransactionBuilder.fromXDR(signedXdr, networkPassphrase) as Transaction;
  } catch {
    return {
      ok: false,
      expectedHash: expected.hash().toString('hex'),
      actualHash: 'unparseable',
      mismatches: [
        {
          field: 'signedPayload',
          expected: expected.hash().toString('hex'),
          actual: 'unparseable',
        },
      ],
    };
  }

  const expectedHash = expected.hash().toString('hex');
  const actualHash = signed.hash().toString('hex');
  const mismatches: IntentMismatch[] = [];

  if (expectedHash !== actualHash) {
    mismatches.push({ field: 'signedPayload', expected: expectedHash, actual: actualHash });
  }

  if (signed.signatures.length === 0) {
    mismatches.push({ field: 'signatures', expected: 'at least 1', actual: '0' });
  }

  if (signed.source !== expected.source) {
    mismatches.push({ field: 'account', expected: expected.source, actual: signed.source });
  }

  if (signed.fee !== expected.fee) {
    mismatches.push({ field: 'fee', expected: String(expected.fee), actual: String(signed.fee) });
  }

  if (signed.sequence !== expected.sequence) {
    mismatches.push({
      field: 'sequence',
      expected: expected.sequence,
      actual: signed.sequence,
    });
  }

  if (memoText(signed.memo) !== memoText(expected.memo)) {
    mismatches.push({
      field: 'memo',
      expected: memoText(expected.memo) ?? 'None',
      actual: memoText(signed.memo) ?? 'None',
    });
  }

  if (signed.operations.length !== expected.operations.length) {
    mismatches.push({
      field: 'operations',
      expected: String(expected.operations.length),
      actual: String(signed.operations.length),
    });
  }

  return { ok: mismatches.length === 0, expectedHash, actualHash, mismatches };
}

/* -------------------------------------------------------------------------- */
/* Horizen (EVM)                                                              */
/* -------------------------------------------------------------------------- */

export interface EvmSendIntentParams {
  chainId: number;
  account: string;
  to: string;
  stealthAddress: string;
  data: string;
  value: bigint;
  gas?: bigint;
  maxFeePerGas?: bigint;
  memo?: string;
}

export function buildEvmSendIntent(params: EvmSendIntentParams): TransactionIntent {
  return {
    chain: 'horizen',
    network: `eip155:${params.chainId}`,
    account: params.account.toLowerCase(),
    recipient: params.stealthAddress.toLowerCase(),
    asset: 'ETH',
    amount: params.value.toString(),
    fee: params.maxFeePerGas
      ? `${params.gas ?? 0n} gas @ ${params.maxFeePerGas} wei`
      : 'wallet-determined',
    memo: params.memo?.trim() ? params.memo.trim() : null,
    contract: {
      address: params.to.toLowerCase(),
      method: 'stealthTransfer',
      args: [`value=${params.value.toString()}`, `data=${params.data.toLowerCase()}`],
    },
    extra: {
      chainId: String(params.chainId),
      data: params.data.toLowerCase(),
      value: params.value.toString(),
    },
  };
}

export interface EvmSubmittedTransaction {
  chainId?: number;
  from: string;
  to: string | null;
  value: bigint;
  input: string;
}

export function verifyEvmSubmittedTransaction(
  expected: TransactionIntent,
  submitted: EvmSubmittedTransaction,
): IntentVerification {
  const mismatches: IntentMismatch[] = [];
  const actualChainId = submitted.chainId ?? Number(expected.extra.chainId);

  if (String(actualChainId) !== expected.extra.chainId) {
    mismatches.push({
      field: 'network',
      expected: expected.extra.chainId,
      actual: String(actualChainId),
    });
  }

  if (submitted.from.toLowerCase() !== expected.account) {
    mismatches.push({ field: 'account', expected: expected.account, actual: submitted.from });
  }

  const expectedContract = expected.contract?.address ?? expected.recipient;
  if ((submitted.to ?? '').toLowerCase() !== expectedContract) {
    mismatches.push({
      field: 'recipient',
      expected: expectedContract,
      actual: submitted.to ?? '(none)',
    });
  }

  if (submitted.value.toString() !== expected.amount) {
    mismatches.push({
      field: 'amount',
      expected: expected.amount,
      actual: submitted.value.toString(),
    });
  }

  if (submitted.input.toLowerCase() !== expected.extra.data) {
    mismatches.push({
      field: 'contract',
      expected: expected.extra.data,
      actual: submitted.input.toLowerCase(),
    });
  }

  return {
    ok: mismatches.length === 0,
    expectedHash: fingerprintIntent(expected),
    actualHash: fingerprintIntent(expected),
    mismatches,
  };
}

/* -------------------------------------------------------------------------- */
/* Solana                                                                     */
/* -------------------------------------------------------------------------- */

export interface SolanaSendIntentParams {
  network: string;
  account: string;
  stealthAddress: string;
  lamports: bigint;
  recentBlockhash: string;
  programId: string;
  instructionData: string;
}

export function buildSolanaSendIntent(params: SolanaSendIntentParams): TransactionIntent {
  return {
    chain: 'solana',
    network: params.network,
    account: params.account,
    recipient: params.stealthAddress,
    asset: 'SOL',
    amount: params.lamports.toString(),
    fee: '5000',
    memo: null,
    contract: {
      address: params.programId,
      method: 'transfer',
      args: [
        `from=${params.account}`,
        `to=${params.stealthAddress}`,
        `lamports=${params.lamports.toString()}`,
        `data=${params.instructionData}`,
      ],
    },
    extra: {
      recentBlockhash: params.recentBlockhash,
      programId: params.programId,
      instructionData: params.instructionData,
    },
  };
}

/**
 * The signature covers the serialized message, so comparing message bytes is
 * enough to prove the wallet signed exactly the confirmed transfer.
 */
export function verifySolanaSignedTransaction(
  expected: SolanaTransaction,
  signed: SolanaTransaction,
): IntentVerification {
  const expectedMessage = expected.serializeMessage();
  const actualMessage = signed.serializeMessage();
  const mismatches: IntentMismatch[] = [];

  if (!expectedMessage.equals(actualMessage)) {
    mismatches.push({
      field: 'signedPayload',
      expected: expectedMessage.toString('hex'),
      actual: actualMessage.toString('hex'),
    });
  }

  const expectedFeePayer = expected.feePayer?.toBase58() ?? '';
  const actualFeePayer = signed.feePayer?.toBase58() ?? '';
  if (expectedFeePayer !== actualFeePayer) {
    mismatches.push({ field: 'account', expected: expectedFeePayer, actual: actualFeePayer });
  }

  if (signed.signatures.filter((signature) => signature.signature).length === 0) {
    mismatches.push({ field: 'signatures', expected: 'at least 1', actual: '0' });
  }

  return {
    ok: mismatches.length === 0,
    expectedHash: expectedMessage.toString('hex'),
    actualHash: actualMessage.toString('hex'),
    mismatches,
  };
}

/* -------------------------------------------------------------------------- */
/* CKB                                                                        */
/* -------------------------------------------------------------------------- */

export interface CkbSendIntentParams {
  network: string;
  account: string;
  stealthPubKey: string;
  lockArgs: string;
  lockCodeHash: string;
  capacityShannons: bigint;
  feeShannons: bigint;
  txHash: string;
}

export function buildCkbSendIntent(params: CkbSendIntentParams): TransactionIntent {
  return {
    chain: 'ckb',
    network: params.network,
    account: params.account,
    recipient: params.stealthPubKey,
    asset: 'CKB',
    amount: params.capacityShannons.toString(),
    fee: params.feeShannons.toString(),
    memo: null,
    contract: {
      address: params.lockCodeHash,
      method: 'stealthLock',
      args: [`lockArgs=${params.lockArgs}`, `capacity=${params.capacityShannons.toString()}`],
    },
    extra: {
      lockArgs: params.lockArgs,
      lockCodeHash: params.lockCodeHash,
      txHash: params.txHash,
    },
  };
}

export function verifyCkbSignedTransaction(
  expectedTxHash: string,
  signedTxHash: string,
): IntentVerification {
  const mismatches: IntentMismatch[] = [];
  if (expectedTxHash.toLowerCase() !== signedTxHash.toLowerCase()) {
    mismatches.push({
      field: 'signedPayload',
      expected: expectedTxHash,
      actual: signedTxHash,
    });
  }

  return {
    ok: mismatches.length === 0,
    expectedHash: expectedTxHash,
    actualHash: signedTxHash,
    mismatches,
  };
}
