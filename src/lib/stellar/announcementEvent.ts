import { bytesToHex } from '@wraith-protocol/sdk/chains/stellar';
import type { Announcement } from '@wraith-protocol/sdk/chains/stellar';
import { Address, xdr } from '@stellar/stellar-sdk';

/** Decodes one Announcer event from Soroban RPC `getEvents`; null if it isn't an announcement. */
export function parseAnnouncementEvent(event: Record<string, unknown>): Announcement | null {
  const topics = event.topic as string[];
  if (!topics || topics.length < 3) return null;

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
