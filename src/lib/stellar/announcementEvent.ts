import { bytesToHex } from '@wraith-protocol/sdk/chains/stellar';
import type { Announcement } from '@wraith-protocol/sdk/chains/stellar';
import { Address, xdr } from '@stellar/stellar-sdk';

/**
 * Decodes one Announcer event from Soroban RPC `getEvents`; null if it isn't one.
 *
 * v1: topics [name, scheme, stealth_address]       value [caller, ephemeral_pub, metadata]
 * v2: topics [name, scheme, view_tag_bucket, ...]  value [stealth_address, ephemeral_pub, metadata]
 */
export function parseAnnouncementEvent(event: Record<string, unknown>): Announcement | null {
  const topics = event.topic;
  if (!Array.isArray(topics)) return null;
  if (topics.length === 3) return parseV1(event, topics as string[]);
  if (topics.length === 4) return parseV2(event, topics as string[]);
  return null;
}

function parseV1(event: Record<string, unknown>, topics: string[]): Announcement | null {
  const schemeId = xdr.ScVal.fromXDR(topics[1], 'base64').u32();
  const stealthScVal = xdr.ScVal.fromXDR(topics[2], 'base64');
  const stealthAddress = Address.fromScAddress(stealthScVal.address()).toString();

  const valueVec = xdr.ScVal.fromXDR(event.value as string, 'base64').vec();
  if (!valueVec || valueVec.length < 3) return null;

  const caller = Address.fromScAddress(valueVec[0].address()).toString();
  const ephemeralPubKey = bytesToHex(new Uint8Array(valueVec[1].bytes()));
  const metadata = bytesToHex(new Uint8Array(valueVec[2].bytes()));

  return { schemeId, stealthAddress, caller, ephemeralPubKey, metadata };
}

function parseV2(event: Record<string, unknown>, topics: string[]): Announcement | null {
  const schemeId = xdr.ScVal.fromXDR(topics[1], 'base64').u32();

  const valueVec = xdr.ScVal.fromXDR(event.value as string, 'base64').vec();
  if (!valueVec || valueVec.length < 3) return null;

  const stealthAddress = Address.fromScAddress(valueVec[0].address()).toString();
  const ephemeralPubKey = bytesToHex(new Uint8Array(valueVec[1].bytes()));
  const metadata = bytesToHex(new Uint8Array(valueVec[2].bytes()));

  // v2 events don't carry a caller; the SDK records the emitting contract instead.
  const caller =
    typeof event.contractId === 'string'
      ? event.contractId
      : typeof event.contract_id === 'string'
        ? event.contract_id
        : '';

  return { schemeId, stealthAddress, caller, ephemeralPubKey, metadata };
}

/** Decodes one page of RPC events, skipping entries that are not (or cannot be decoded as) announcements. */
export function decodeAnnouncementEvents(events: readonly object[]): Announcement[] {
  const announcements: Announcement[] = [];
  for (const event of events) {
    try {
      const announcement = parseAnnouncementEvent(event as Record<string, unknown>);
      if (announcement) announcements.push(announcement);
    } catch {
      // An undecodable event must not abort the page: the cursor still has to cover its neighbours.
    }
  }
  return announcements;
}
