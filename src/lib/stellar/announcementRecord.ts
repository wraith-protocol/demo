import type { Announcement } from '@wraith-protocol/sdk/chains/stellar';

export interface AnnouncementRecord extends Announcement {}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHexString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length % 2 === 0 &&
    /^[0-9a-fA-F]+$/.test(value)
  );
}

export function isAnnouncementRecord(value: unknown): value is AnnouncementRecord {
  if (!isRecord(value)) return false;
  const { schemeId, stealthAddress, caller, ephemeralPubKey, metadata } = value;
  return (
    typeof schemeId === 'number' &&
    Number.isSafeInteger(schemeId) &&
    schemeId >= 0 &&
    typeof stealthAddress === 'string' &&
    stealthAddress.length > 0 &&
    typeof caller === 'string' &&
    caller.length > 0 &&
    isHexString(ephemeralPubKey) &&
    isHexString(metadata)
  );
}

export function parseAnnouncementRecord(value: unknown): AnnouncementRecord | null {
  if (!isAnnouncementRecord(value)) return null;
  const { schemeId, stealthAddress, caller, ephemeralPubKey, metadata } = value;
  return { schemeId, stealthAddress, caller, ephemeralPubKey, metadata };
}

export function parseAnnouncementRecords(value: unknown): AnnouncementRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => parseAnnouncementRecord(entry))
    .filter((entry): entry is AnnouncementRecord => entry !== null);
}
