import { describe, expect, it } from 'vitest';
import {
  isAnnouncementRecord,
  parseAnnouncementRecord,
  parseAnnouncementRecords,
} from './announcementRecord';
import {
  isMatchedAnnouncement,
  isStellarBackgroundMessage,
  isStellarScannerMessage,
} from './scannerMessages';

const announcement = {
  schemeId: 1,
  stealthAddress: 'GSTEALTH',
  caller: 'GCALLER',
  ephemeralPubKey: 'ab'.repeat(32),
  metadata: '00',
};

const matched = {
  ...announcement,
  stealthPrivateScalar: 1n,
  stealthPubKeyBytes: new Uint8Array(32).fill(1),
};

describe('stellar receive contracts', () => {
  it('parses typed announcement records and drops malformed entries', () => {
    expect(parseAnnouncementRecord(announcement)).toEqual(announcement);
    expect(
      parseAnnouncementRecords([
        announcement,
        null,
        { ...announcement, ephemeralPubKey: 'abc' },
        { ...announcement, schemeId: -1 },
      ]),
    ).toEqual([announcement]);
  });

  it('rejects announcement records with missing or invalid fields', () => {
    expect(isAnnouncementRecord({ ...announcement, stealthAddress: '' })).toBe(false);
    expect(isAnnouncementRecord({ ...announcement, metadata: 'zz' })).toBe(false);
    expect(isAnnouncementRecord({ ...announcement, schemeId: Number.NaN })).toBe(false);
  });

  it('requires derived key material before treating an announcement as matched', () => {
    expect(isMatchedAnnouncement(matched)).toBe(true);
    expect(isMatchedAnnouncement({ ...announcement, stealthPrivateScalar: 1 })).toBe(false);
    expect(isMatchedAnnouncement({ ...announcement, stealthPubKeyBytes: [1, 2] })).toBe(false);
  });

  it('validates scanner messages before applying them to receive state', () => {
    expect(isStellarScannerMessage({ type: 'ERROR', error: 'rpc down' })).toBe(true);
    expect(
      isStellarScannerMessage({
        type: 'SUCCESS',
        results: [matched],
        nextLedger: 10,
        committedLedger: 9,
        pages: 1,
        truncated: false,
      }),
    ).toBe(true);
    expect(
      isStellarScannerMessage({
        type: 'SUCCESS',
        results: [announcement],
        nextLedger: 10,
        committedLedger: 9,
        pages: 1,
        truncated: false,
      }),
    ).toBe(false);
    expect(isStellarScannerMessage({ type: 'UNKNOWN' })).toBe(false);
  });

  it('validates background scan messages', () => {
    expect(
      isStellarBackgroundMessage({
        type: 'STELLAR_SCAN_RETENTION_GAP',
        publicKey: 'GWALLET',
        requestedLedger: 100,
        oldestAvailableLedger: 250,
      }),
    ).toBe(true);
    expect(
      isStellarBackgroundMessage({
        type: 'STELLAR_SCAN_RECOVERY_COMPLETE',
        publicKey: 'GWALLET',
      }),
    ).toBe(true);
    expect(
      isStellarBackgroundMessage({
        type: 'STELLAR_SCAN_RETENTION_GAP',
        requestedLedger: 100,
        oldestAvailableLedger: 250,
      }),
    ).toBe(false);
  });
});
