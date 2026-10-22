import { Address, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  bytesToHex,
  deriveStealthKeys,
  generateStealthAddress,
} from '@wraith-protocol/sdk/chains/stellar';
import { parseAnnouncementEvent, decodeAnnouncementEvents } from './announcementEvent';

const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const u32 = (n: number) => xdr.ScVal.scvU32(n);
const addr = (a: string) => xdr.ScVal.scvAddress(new Address(a).toScAddress());
const bytes = (b: Uint8Array) => xdr.ScVal.scvBytes(Buffer.from(b));
const b64 = (v: xdr.ScVal) => v.toXDR('base64');

function randomSignature(): Uint8Array {
  const out = new Uint8Array(64);
  crypto.getRandomValues(out);
  return out;
}

function fixture() {
  const a = deriveStealthKeys(randomSignature());
  const b = deriveStealthKeys(randomSignature());
  const first = generateStealthAddress(a.spendingPubKey, a.viewingPubKey);
  const second = generateStealthAddress(b.spendingPubKey, b.viewingPubKey);
  return {
    stealth: first.stealthAddress,
    caller: second.stealthAddress,
    eph: first.ephemeralPubKey,
    meta: new Uint8Array([7, 1, 2]),
  };
}

describe('parseAnnouncementEvent', () => {
  it('decodes a v1 event (3 topics, stealth address in topic 2)', () => {
    const f = fixture();
    const event = {
      topic: [b64(sym('announce')), b64(u32(1)), b64(addr(f.stealth))],
      value: b64(xdr.ScVal.scvVec([addr(f.caller), bytes(f.eph), bytes(f.meta)])),
    };
    expect(parseAnnouncementEvent(event)).toEqual({
      schemeId: 1,
      stealthAddress: f.stealth,
      caller: f.caller,
      ephemeralPubKey: bytesToHex(f.eph),
      metadata: bytesToHex(f.meta),
    });
  });

  it('decodes a v2 event (4 topics, stealth address in the value)', () => {
    const f = fixture();
    const event = {
      contractId: 'CANNOUNCER',
      topic: [b64(sym('announce')), b64(u32(2)), b64(u32(7)), b64(u32(0))],
      value: b64(xdr.ScVal.scvVec([addr(f.stealth), bytes(f.eph), bytes(f.meta)])),
    };
    expect(parseAnnouncementEvent(event)).toEqual({
      schemeId: 2,
      stealthAddress: f.stealth,
      caller: 'CANNOUNCER',
      ephemeralPubKey: bytesToHex(f.eph),
      metadata: bytesToHex(f.meta),
    });
  });

  it('returns null for unknown shapes', () => {
    const f = fixture();
    const topics = [b64(sym('announce')), b64(u32(2)), b64(u32(7)), b64(u32(0))];
    const value = b64(xdr.ScVal.scvVec([addr(f.stealth), bytes(f.eph), bytes(f.meta)]));
    expect(parseAnnouncementEvent({ topic: [...topics, topics[0]], value })).toBeNull();
    expect(parseAnnouncementEvent({ topic: topics.slice(0, 2), value })).toBeNull();
    expect(parseAnnouncementEvent({ topic: 'nope', value })).toBeNull();
    const shortValue = b64(xdr.ScVal.scvVec([addr(f.stealth), bytes(f.eph)]));
    expect(parseAnnouncementEvent({ topic: topics, value: shortValue })).toBeNull();
  });
});

describe('decodeAnnouncementEvents', () => {
  it('decodes valid v1 and v2 events and skips junk', () => {
    const f = fixture();
    const v1 = {
      topic: [b64(sym('announce')), b64(u32(1)), b64(addr(f.stealth))],
      value: b64(xdr.ScVal.scvVec([addr(f.caller), bytes(f.eph), bytes(f.meta)])),
    };
    const v2 = {
      contractId: 'CANNOUNCER',
      topic: [b64(sym('announce')), b64(u32(2)), b64(u32(7)), b64(u32(0))],
      value: b64(xdr.ScVal.scvVec([addr(f.stealth), bytes(f.eph), bytes(f.meta)])),
    };
    const result = decodeAnnouncementEvents([v1, { topic: ['bad'], value: 'bad' }, v2, {}]);
    expect(result.map((a) => a.schemeId)).toEqual([1, 2]);
  });
});
