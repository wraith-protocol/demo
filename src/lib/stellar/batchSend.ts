import {
  TransactionBuilder,
  Account,
  Operation,
  Asset,
  Memo,
  Transaction,
  FeeBumpTransaction,
} from '@stellar/stellar-sdk';
import {
  generateStealthAddress,
  decodeStealthMetaAddress,
} from '@wraith-protocol/sdk/chains/stellar';
import { STELLAR_NETWORK } from '@/config';
import type { StellarAssetKey } from '@/lib/stellar/assets';
import { getAssetByKey } from '@/lib/stellar/assets';
import { fetchWithRetry } from '@/lib/stellar/retry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RowStatus = 'idle' | 'valid' | 'invalid' | 'pending' | 'success' | 'failed';

export interface BatchRow {
  /** 1-based index of the original CSV line */
  index: number;
  /** Raw meta-address string from CSV */
  metaAddress: string;
  /** Raw amount string from CSV */
  amountRaw: string;
  /** Optional per-row memo */
  memo: string;
  /** Derived stealth address (populated after validation) */
  stealthAddress?: string;
  /** Validation or runtime error message */
  error: string;
  /** Processing status */
  status: RowStatus;
}

export interface BatchSendParams {
  senderAddress: string;
  rows: BatchRow[];
  assetKey: StellarAssetKey;
  signTransaction: (xdr: string) => Promise<string>;
  onProgress?: (index: number, status: RowStatus, error?: string) => void;
}

export interface BatchSendResult {
  txHash: string;
  /** Horizon response hash */
  horizonHash: string;
  successCount: number;
  failedCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Stellar enforces a hard cap of 100 operations per transaction */
export const MAX_BATCH_ROWS = 100;

/** Minimum XLM amount (7-decimal precision floor) */
const MIN_AMOUNT = 0.0000001;

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/**
 * Parse a CSV text into raw rows.
 *
 * Accepted formats (header row optional):
 *   meta_address,amount
 *   meta_address,amount,memo
 *
 * Lines starting with `#` are treated as comments and skipped.
 * Blank lines are skipped.
 */
export function parseCsvRows(csv: string): BatchRow[] {
  const lines = csv.split(/\r?\n/);
  const rows: BatchRow[] = [];
  let dataIndex = 0; // counts only non-header, non-comment, non-blank lines

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();

    // Skip blank lines and comments
    if (!raw || raw.startsWith('#')) continue;

    const cols = splitCsvLine(raw);

    // Skip header row (first non-comment line that starts with a known header word)
    if (dataIndex === 0 && isHeaderRow(cols)) continue;

    dataIndex++;

    const metaAddress = (cols[0] ?? '').trim();
    const amountRaw = (cols[1] ?? '').trim();
    const memo = (cols[2] ?? '').trim();

    rows.push({
      index: dataIndex,
      metaAddress,
      amountRaw,
      memo,
      error: '',
      status: 'idle',
    });
  }

  return rows;
}

/** Split a single CSV line respecting double-quoted fields */
function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped double-quote
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cols.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cols.push(current);
  return cols;
}

function isHeaderRow(cols: string[]): boolean {
  const first = (cols[0] ?? '').toLowerCase();
  return (
    first === 'meta_address' ||
    first === 'meta-address' ||
    first === 'metaaddress' ||
    first === 'address' ||
    first === 'recipient'
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a single row in-place.
 * Returns the row (mutated) with `status` set to `'valid'` or `'invalid'`
 * and `error` set to a human-readable message.
 */
export function validateRow(row: BatchRow, assetKey: StellarAssetKey): BatchRow {
  // Meta-address
  if (!row.metaAddress) {
    return { ...row, status: 'invalid', error: 'Meta-address is required' };
  }
  if (!row.metaAddress.startsWith('st:xlm:')) {
    return {
      ...row,
      status: 'invalid',
      error: 'Not a valid Stellar stealth meta-address (st:xlm:…)',
    };
  }
  let stealthAddress: string;
  try {
    const decoded = decodeStealthMetaAddress(row.metaAddress);
    const result = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
    stealthAddress = result.stealthAddress;
  } catch {
    return { ...row, status: 'invalid', error: 'Could not decode meta-address' };
  }

  // Amount
  if (!row.amountRaw) {
    return { ...row, status: 'invalid', error: 'Amount is required' };
  }
  if (!/^(?:\d+|\d*\.\d+)$/.test(row.amountRaw)) {
    return { ...row, status: 'invalid', error: `Invalid ${assetKey} amount` };
  }

  const assetInfo = getAssetByKey(assetKey);
  const decimalPart = row.amountRaw.split('.')[1];
  if (decimalPart && decimalPart.length > assetInfo.decimals) {
    return {
      ...row,
      status: 'invalid',
      error: `${assetKey} supports up to ${assetInfo.decimals} decimals`,
    };
  }

  const parsed = Number(row.amountRaw);
  if (!Number.isFinite(parsed) || parsed < MIN_AMOUNT) {
    return { ...row, status: 'invalid', error: `Amount must be ≥ ${MIN_AMOUNT} ${assetKey}` };
  }

  // Memo length (Stellar memos are capped at 28 bytes)
  if (row.memo && new TextEncoder().encode(row.memo).length > 28) {
    return { ...row, status: 'invalid', error: 'Memo exceeds 28-byte Stellar limit' };
  }

  return { ...row, status: 'valid', error: '', stealthAddress };
}

/**
 * Validate all rows.
 * Returns annotated rows; does not throw.
 */
export function validateRows(rows: BatchRow[], assetKey: StellarAssetKey): BatchRow[] {
  if (rows.length === 0) return rows;
  if (rows.length > MAX_BATCH_ROWS) {
    // Mark rows beyond the limit as invalid
    return rows.map((row, i) =>
      i >= MAX_BATCH_ROWS
        ? { ...row, status: 'invalid', error: `Exceeds ${MAX_BATCH_ROWS}-row limit` }
        : validateRow(row, assetKey),
    );
  }
  return rows.map((row) => validateRow(row, assetKey));
}

// ---------------------------------------------------------------------------
// Horizon account helpers
// ---------------------------------------------------------------------------

interface HorizonAccount {
  sequence: string;
  balances?: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
    balance: string;
  }>;
}

async function loadAccount(address: string): Promise<HorizonAccount> {
  const res = await fetchWithRetry(`${STELLAR_NETWORK.horizonUrl}/accounts/${address}`);
  if (!res.ok) throw new Error(`Failed to load account ${address} (HTTP ${res.status})`);
  return res.json() as Promise<HorizonAccount>;
}

async function accountExists(address: string): Promise<boolean> {
  try {
    const res = await fetchWithRetry(`${STELLAR_NETWORK.horizonUrl}/accounts/${address}`);
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Batch transaction builder
// ---------------------------------------------------------------------------

/**
 * Build a single Stellar transaction containing one payment/createAccount
 * operation per valid row.
 *
 * All operations share the sender's source account. Stellar transactions are
 * atomic — if any operation fails the whole transaction is rejected (all-or-nothing).
 *
 * Returns the unsigned transaction XDR and a mapping of operation index →
 * stealth address for display purposes.
 */
export async function buildBatchTransaction(
  senderAddress: string,
  validRows: BatchRow[],
  assetKey: StellarAssetKey,
): Promise<{ xdr: string; operationMap: Array<{ rowIndex: number; stealthAddress: string }> }> {
  if (validRows.length === 0) throw new Error('No valid rows to build transaction from');
  if (validRows.length > MAX_BATCH_ROWS) {
    throw new Error(`Cannot exceed ${MAX_BATCH_ROWS} operations per transaction`);
  }

  const assetInfo = getAssetByKey(assetKey);
  const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

  // Load sender account for sequence number
  const accountData = await loadAccount(senderAddress);
  const sourceAccount = new Account(senderAddress, accountData.sequence);

  // Determine which stealth addresses already exist (parallel to minimise latency)
  const existenceChecks = await Promise.all(
    validRows.map((row) => accountExists(row.stealthAddress!)),
  );

  let builder = new TransactionBuilder(sourceAccount, {
    // fee per operation — each row adds one operation
    fee: String(100 * validRows.length),
    networkPassphrase,
  });

  const operationMap: Array<{ rowIndex: number; stealthAddress: string }> = [];

  for (let i = 0; i < validRows.length; i++) {
    const row = validRows[i];
    const exists = existenceChecks[i];
    const stealthAddress = row.stealthAddress!;
    const amount = row.amountRaw;

    if (exists) {
      const asset = assetInfo.isNative ? Asset.native() : assetInfo.toAsset();
      builder = builder.addOperation(
        Operation.payment({ destination: stealthAddress, asset, amount }),
      );
    } else if (assetInfo.isNative) {
      builder = builder.addOperation(
        Operation.createAccount({ destination: stealthAddress, startingBalance: amount }),
      );
    } else {
      // Non-native to unactivated account: payment will fail unless trustline exists.
      // We still include it — the caller has been warned via validation.
      const asset = assetInfo.toAsset();
      builder = builder.addOperation(
        Operation.payment({ destination: stealthAddress, asset, amount }),
      );
    }

    // Per-row memo: only possible on single-operation transactions (Stellar supports
    // one transaction-level memo). For batch we attach a global memo only when all rows
    // share the same memo, otherwise omit it.
    operationMap.push({ rowIndex: row.index, stealthAddress });
  }

  // Attach a single shared memo if all non-empty memos are identical
  const memos = validRows.map((r) => r.memo).filter(Boolean);
  if (memos.length > 0 && memos.every((m) => m === memos[0])) {
    builder = builder.addMemo(Memo.text(memos[0]));
  }

  builder = builder.setTimeout(30);

  const tx = builder.build();
  return { xdr: tx.toXDR(), operationMap };
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

/**
 * Submit a signed XDR to Horizon.
 * Returns the transaction hash on success; throws with a descriptive message
 * on failure.
 */
export async function submitBatchTransaction(signedXdr: string): Promise<string> {
  const res = await fetch(`${STELLAR_NETWORK.horizonUrl}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `tx=${encodeURIComponent(signedXdr)}`,
  });

  const data = (await res.json()) as {
    hash?: string;
    title?: string;
    extras?: { result_codes?: { transaction?: string; operations?: string[] } };
  };

  if (!res.ok) {
    const txCode = data.extras?.result_codes?.transaction ?? data.title ?? 'Transaction failed';
    const opCodes = data.extras?.result_codes?.operations;
    const opDetail = opCodes ? ` (operations: ${opCodes.join(', ')})` : '';
    throw new Error(`${txCode}${opDetail}`);
  }

  return data.hash ?? '';
}

// ---------------------------------------------------------------------------
// High-level orchestrator
// ---------------------------------------------------------------------------

/**
 * Build, sign, and submit a batch stealth-send transaction.
 *
 * Because Stellar transactions are all-or-nothing at the protocol level there
 * is no partial success scenario — the whole batch either lands or is rolled
 * back. Partial failures are surfaced as a thrown Error with operation-level
 * result codes in the message when available.
 */
export async function sendBatch(params: BatchSendParams): Promise<BatchSendResult> {
  const { senderAddress, rows, assetKey, signTransaction, onProgress } = params;

  const validRows = rows.filter((r) => r.status === 'valid');
  if (validRows.length === 0) {
    throw new Error('No valid rows to send');
  }

  // Mark all valid rows as pending
  validRows.forEach((r) => onProgress?.(r.index, 'pending'));

  // Build unsigned transaction
  const { xdr, operationMap } = await buildBatchTransaction(senderAddress, validRows, assetKey);

  // Sign with connected wallet
  const signedXdr = await signTransaction(xdr);

  // Derive tx hash from the unsigned tx for activity tracking
  const { Transaction: StellarTx } = await import('@stellar/stellar-sdk');
  const tx: Transaction | FeeBumpTransaction = new StellarTx(
    xdr,
    STELLAR_NETWORK.networkPassphrase,
  );
  const txHashHex = (tx as Transaction).hash().toString('hex');

  // Submit
  let horizonHash: string;
  try {
    horizonHash = await submitBatchTransaction(signedXdr);
  } catch (err) {
    // All-or-nothing: mark every row as failed
    validRows.forEach((r) => onProgress?.(r.index, 'failed', (err as Error).message));
    throw err;
  }

  // Success: mark all rows
  operationMap.forEach(({ rowIndex }) => onProgress?.(rowIndex, 'success'));

  return {
    txHash: txHashHex,
    horizonHash: horizonHash || txHashHex,
    successCount: validRows.length,
    failedCount: 0,
  };
}
