import type { MatchedAnnouncement } from '@wraith-protocol/sdk/chains/stellar';
import { isAnnouncementRecord } from './announcementRecord';
import type { ScanStrategy } from '../../workers/stellarScanDispatch';

export interface StellarScannerRequest {
  rpcUrl: string;
  announcerContract: string;
  viewingKey: Uint8Array;
  spendingPubKey: Uint8Array;
  spendingScalar: bigint;
  strategy?: ScanStrategy;
  startLedger?: number;
  pageLimit?: number;
}

export type StellarScannerMessage =
  | {
      type: 'PAGE';
      page: number;
      committedLedger: number;
      events: number;
      undecodableEvents: number;
      matched: MatchedAnnouncement[];
    }
  | {
      type: 'SUCCESS';
      results: MatchedAnnouncement[];
      nextLedger: number;
      committedLedger: number;
      pages: number;
      truncated: boolean;
    }
  | { type: 'RETENTION_GAP'; requestedLedger: number; oldestAvailableLedger: number }
  | { type: 'ERROR'; error: string };

export type StellarBackgroundMessage =
  | {
      type: 'STELLAR_SCAN_RETENTION_GAP';
      publicKey: string;
      requestedLedger: number;
      oldestAvailableLedger: number;
    }
  | { type: 'STELLAR_SCAN_RECOVERY_COMPLETE'; publicKey: string };

export interface RecoverScanCursorCommand {
  type: 'RECOVER_SCAN_CURSOR';
  publicKey?: string;
  oldestAvailableLedger: number;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isMatchedAnnouncement(value: unknown): value is MatchedAnnouncement {
  return (
    isAnnouncementRecord(value) &&
    isRecord(value) &&
    typeof value.stealthPrivateScalar === 'bigint' &&
    value.stealthPubKeyBytes instanceof Uint8Array
  );
}

export function isStellarScannerMessage(value: unknown): value is StellarScannerMessage {
  if (!isRecord(value)) return false;

  switch (value.type) {
    case 'PAGE':
      return (
        isPositiveInteger(value.page) &&
        isNonNegativeInteger(value.committedLedger) &&
        isNonNegativeInteger(value.events) &&
        isNonNegativeInteger(value.undecodableEvents) &&
        Array.isArray(value.matched) &&
        value.matched.every(isMatchedAnnouncement)
      );
    case 'SUCCESS':
      return (
        Array.isArray(value.results) &&
        value.results.every(isMatchedAnnouncement) &&
        isPositiveInteger(value.nextLedger) &&
        isNonNegativeInteger(value.committedLedger) &&
        isNonNegativeInteger(value.pages) &&
        typeof value.truncated === 'boolean'
      );
    case 'RETENTION_GAP':
      return (
        isPositiveInteger(value.requestedLedger) && isPositiveInteger(value.oldestAvailableLedger)
      );
    case 'ERROR':
      return typeof value.error === 'string';
    default:
      return false;
  }
}

export function isStellarBackgroundMessage(value: unknown): value is StellarBackgroundMessage {
  if (!isRecord(value) || typeof value.publicKey !== 'string') return false;

  if (value.type === 'STELLAR_SCAN_RECOVERY_COMPLETE') return true;
  return (
    value.type === 'STELLAR_SCAN_RETENTION_GAP' &&
    isPositiveInteger(value.requestedLedger) &&
    isPositiveInteger(value.oldestAvailableLedger)
  );
}
