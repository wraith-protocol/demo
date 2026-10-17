export interface RetentionGap {
  requestedLedger: number;
  oldestAvailableLedger: number;
}

export type RetentionErrorCode = 'WRAITH/NETWORK/RETENTION_EXCEEDED';

export class StellarRetentionExceededError extends Error implements RetentionGap {
  readonly code: RetentionErrorCode = 'WRAITH/NETWORK/RETENTION_EXCEEDED';
  readonly requestedLedger: number;
  readonly oldestAvailableLedger: number;

  constructor(requestedLedger: number, oldestAvailableLedger: number) {
    super(
      `Requested Stellar ledger ${requestedLedger} is older than the Soroban retention window. Oldest available ledger is ${oldestAvailableLedger}.`,
    );
    this.name = 'RetentionExceededError';
    this.requestedLedger = requestedLedger;
    this.oldestAvailableLedger = oldestAvailableLedger;
  }
}

interface RetentionErrorLike {
  name?: unknown;
  code?: unknown;
  requestedLedger?: number;
  oldestAvailableLedger?: number;
}

const RETENTION_ERROR_CODE: RetentionErrorCode = 'WRAITH/NETWORK/RETENTION_EXCEEDED';

const CURSOR_PREFIX = 'wraith-stellar-scan-cursor';

export function scanCursorKey(walletAddress: string): string {
  return `${CURSOR_PREFIX}:${walletAddress}`;
}

export function readScanCursor(storage: Storage, walletAddress: string): number | undefined {
  const value = storage.getItem(scanCursorKey(walletAddress));
  if (!value) return undefined;
  const ledger = Number(value);
  return Number.isSafeInteger(ledger) && ledger > 0 ? ledger : undefined;
}

export function writeScanCursor(storage: Storage, walletAddress: string, ledger: number): void {
  if (!Number.isSafeInteger(ledger) || ledger <= 0) throw new Error('Invalid scan cursor');
  storage.setItem(scanCursorKey(walletAddress), String(ledger));
}

export function retentionGapFromError(error: unknown): RetentionGap | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as RetentionErrorLike;
  const isRetentionError =
    candidate.name === 'RetentionExceededError' ||
    candidate.code === RETENTION_ERROR_CODE;
  if (!isRetentionError) return undefined;

  const requestedLedger = Number(candidate.requestedLedger);
  const oldestAvailableLedger = Number(candidate.oldestAvailableLedger);
  if (
    !Number.isSafeInteger(requestedLedger) ||
    !Number.isSafeInteger(oldestAvailableLedger) ||
    requestedLedger <= 0 ||
    oldestAvailableLedger <= requestedLedger
  ) {
    return undefined;
  }
  return { requestedLedger, oldestAvailableLedger };
}

export function retentionErrorFromRpcMessage(
  requestedLedger: number,
  message: string,
): StellarRetentionExceededError | undefined {
  const match = message.match(/range:\s*(\d+)\s*-\s*(\d+)/i);
  if (!match) return undefined;
  const oldestAvailableLedger = Number(match[1]);
  if (requestedLedger >= oldestAvailableLedger) return undefined;
  return new StellarRetentionExceededError(requestedLedger, oldestAvailableLedger);
}
