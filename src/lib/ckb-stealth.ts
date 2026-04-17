import { ed25519 } from '@noble/curves/ed25519';
import { x25519, edwardsToMontgomeryPub, edwardsToMontgomeryPriv } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';

const L = BigInt('7237005577332262213973186563042994240857116359379907606001950938285454250989');

const META_ADDRESS_PREFIX = 'st:ckb:';
const SCHEME_ID = 1;
const STEALTH_SIGNING_MESSAGE =
  'Sign this message to generate your Wraith stealth keys.\n\nChain: CKB\nNote: This signature is used for key derivation only and does not authorize any transaction.';

export { META_ADDRESS_PREFIX, SCHEME_ID, STEALTH_SIGNING_MESSAGE };

export interface StealthKeys {
  spendingKey: Uint8Array;
  spendingScalar: bigint;
  viewingKey: Uint8Array;
  viewingScalar: bigint;
  spendingPubKey: Uint8Array;
  viewingPubKey: Uint8Array;
}

export interface StealthMetaAddress {
  prefix: string;
  spendingPubKey: Uint8Array;
  viewingPubKey: Uint8Array;
}

export interface GeneratedStealthAddress {
  stealthAddress: string;
  lockArgs: string;
  ephemeralPubKey: Uint8Array;
  viewTag: number;
}

export interface StealthCell {
  stealthAddress: string;
  lockArgs: string;
  ephemeralPubKey: string;
  viewTag: number;
  capacity: string;
  outPoint: { txHash: string; index: string };
}

export interface MatchedStealthCell extends StealthCell {
  stealthPrivateScalar: bigint;
  stealthPubKeyBytes: Uint8Array;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToScalar(bytes: Uint8Array): bigint {
  let scalar = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    scalar = (scalar << 8n) | BigInt(bytes[i]);
  }
  return scalar;
}

function scalarToBytes(scalar: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let s = scalar;
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(s & 0xffn);
    s >>= 8n;
  }
  return bytes;
}

function seedToScalar(seed: Uint8Array): bigint {
  const h = sha512(seed);
  const a = new Uint8Array(h.slice(0, 32));
  a[0] &= 248;
  a[31] &= 127;
  a[31] |= 64;
  return bytesToScalar(a);
}

function hashToScalar(sharedSecret: Uint8Array): bigint {
  const prefix = new TextEncoder().encode('wraith:scalar:');
  const input = new Uint8Array(prefix.length + sharedSecret.length);
  input.set(prefix);
  input.set(sharedSecret, prefix.length);
  const hash = sha256(input);
  return bytesToScalar(hash) % L;
}

function computeSharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const privX = edwardsToMontgomeryPriv(privateKey);
  const pubX = edwardsToMontgomeryPub(publicKey);
  return x25519.getSharedSecret(privX, pubX);
}

function computeViewTag(sharedSecret: Uint8Array): number {
  const prefix = new TextEncoder().encode('wraith:tag:');
  const input = new Uint8Array(prefix.length + sharedSecret.length);
  input.set(prefix);
  input.set(sharedSecret, prefix.length);
  return sha256(input)[0];
}

function deriveStealthPubKey(spendingPubKey: Uint8Array, hashScalar: bigint): Uint8Array {
  const K_spend = ed25519.ExtendedPoint.fromHex(spendingPubKey);
  const hashPoint = ed25519.ExtendedPoint.BASE.multiply(hashScalar);
  const stealthPoint = K_spend.add(hashPoint);
  return stealthPoint.toRawBytes();
}

export function deriveStealthKeys(signature: Uint8Array): StealthKeys {
  if (signature.length !== 64) {
    throw new Error(`Expected 64-byte ed25519 signature, got ${signature.length} bytes`);
  }

  const spendingPrefix = new TextEncoder().encode('wraith:spending:');
  const viewingPrefix = new TextEncoder().encode('wraith:viewing:');

  const spendingInput = new Uint8Array(spendingPrefix.length + signature.length);
  spendingInput.set(spendingPrefix);
  spendingInput.set(signature, spendingPrefix.length);

  const viewingInput = new Uint8Array(viewingPrefix.length + signature.length);
  viewingInput.set(viewingPrefix);
  viewingInput.set(signature, viewingPrefix.length);

  const spendingKey = sha256(spendingInput);
  const viewingKey = sha256(viewingInput);

  const spendingScalar = seedToScalar(spendingKey);
  const viewingScalar = seedToScalar(viewingKey);

  const spendingPubKey = ed25519.getPublicKey(spendingKey);
  const viewingPubKey = ed25519.getPublicKey(viewingKey);

  return { spendingKey, spendingScalar, viewingKey, viewingScalar, spendingPubKey, viewingPubKey };
}

export function encodeStealthMetaAddress(
  spendingPubKey: Uint8Array,
  viewingPubKey: Uint8Array,
): string {
  return `${META_ADDRESS_PREFIX}${bytesToHex(spendingPubKey)}${bytesToHex(viewingPubKey)}`;
}

export function decodeStealthMetaAddress(metaAddress: string): StealthMetaAddress {
  if (!metaAddress.startsWith(META_ADDRESS_PREFIX)) {
    throw new Error(`Invalid prefix. Expected "${META_ADDRESS_PREFIX}"`);
  }
  const hex = metaAddress.slice(META_ADDRESS_PREFIX.length);
  if (hex.length !== 128) {
    throw new Error(`Invalid meta-address length`);
  }
  return {
    prefix: META_ADDRESS_PREFIX,
    spendingPubKey: hexToBytes(hex.slice(0, 64)),
    viewingPubKey: hexToBytes(hex.slice(64)),
  };
}

/**
 * Generate a stealth address for CKB. Returns the stealth pubkey as a CKB-style
 * lock args hash (blake160 of the stealth pubkey), along with the ephemeral pubkey
 * and view tag embedded in the lockArgs itself.
 *
 * On CKB the Cell IS the announcement: lockArgs = ephemeralPubKey || viewTag || stealthPubKey
 */
export function generateStealthAddress(
  spendingPubKey: Uint8Array,
  viewingPubKey: Uint8Array,
): GeneratedStealthAddress {
  const ephSeed = ed25519.utils.randomPrivateKey();
  const ephPubKey = ed25519.getPublicKey(ephSeed);
  const sharedSecret = computeSharedSecret(ephSeed, viewingPubKey);
  const viewTag = computeViewTag(sharedSecret);
  const hScalar = hashToScalar(sharedSecret);
  const stealthPubKeyBytes = deriveStealthPubKey(spendingPubKey, hScalar);

  const stealthAddress = `0x${bytesToHex(stealthPubKeyBytes)}`;
  const lockArgs = `0x${bytesToHex(ephPubKey)}${viewTag.toString(16).padStart(2, '0')}${bytesToHex(stealthPubKeyBytes)}`;

  return { stealthAddress, lockArgs, ephemeralPubKey: ephPubKey, viewTag };
}

/**
 * Scan stealth cells for matches. On CKB, each cell's lockArgs contains
 * the ephemeral pubkey, view tag, and stealth pubkey.
 */
export function scanStealthCells(
  cells: StealthCell[],
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  spendingScalar: bigint,
): MatchedStealthCell[] {
  const matched: MatchedStealthCell[] = [];

  for (const cell of cells) {
    const ephPubKey = hexToBytes(cell.ephemeralPubKey);
    if (ephPubKey.length !== 32) continue;

    const sharedSecret = computeSharedSecret(viewingKey, ephPubKey);
    const computedTag = computeViewTag(sharedSecret);
    if (computedTag !== cell.viewTag) continue;

    const hScalar = hashToScalar(sharedSecret);
    const stealthPubKeyBytes = deriveStealthPubKey(spendingPubKey, hScalar);
    const expectedAddr = `0x${bytesToHex(stealthPubKeyBytes)}`;

    if (expectedAddr === cell.stealthAddress) {
      const stealthPrivateScalar = (spendingScalar + hScalar) % L;
      matched.push({ ...cell, stealthPrivateScalar, stealthPubKeyBytes });
    }
  }
  return matched;
}

export { bytesToHex, hexToBytes, scalarToBytes };
