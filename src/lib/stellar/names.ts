import {
  TransactionBuilder,
  Account,
  Contract,
  nativeToScVal,
  scValToNative,
  Address,
  xdr,
} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import { STELLAR_NETWORK } from '@/config';

// Override for futurenet recordings or a new deployment without rebuilding this module.
export const NAMES_CONTRACT_ID =
  import.meta.env.VITE_WRAITH_NAMES_CONTRACT_ID ||
  'CD3Z7J2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';

export interface NameMetadata {
  avatar_url?: string;
  twitter_handle?: string;
  description?: string;
  socials?: Record<string, string>;
}

export interface NameRecord {
  name: string;
  owner: string;
  expires_at: number;
  metadata: NameMetadata;
}

export interface RegistrationParams {
  name: string;
  duration: number; // in seconds
}

export interface TransferParams {
  name: string;
  to: string;
}

export interface RenewParams {
  name: string;
  duration: number; // in seconds
}

export interface MetadataParams {
  name: string;
  metadata: NameMetadata;
}

function asString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'object' && 'toString' in value && typeof value.toString === 'function') {
    const text = value.toString();
    return text && text !== '[object Object]' ? text : undefined;
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeMetadataValue(value: unknown): NameMetadata {
  if (!value || typeof value !== 'object') return {};

  if (value instanceof Map) {
    const entries = Object.fromEntries(
      Array.from(value.entries()).map(([key, entryValue]) => [String(key), entryValue]),
    );
    return normalizeMetadataValue(entries);
  }

  const record = value as Record<string, unknown>;
  const direct = record.metadata ?? record.meta ?? record.attributes ?? record;
  const values = direct && typeof direct === 'object' ? (direct as Record<string, unknown>) : {};

  const metadata: NameMetadata = {};
  const fallbackValues = Object.entries(values).reduce<Record<string, unknown>>(
    (acc, [key, entryValue]) => {
      if (
        typeof entryValue === 'object' &&
        entryValue &&
        'key' in entryValue &&
        'value' in entryValue
      ) {
        acc[String((entryValue as { key?: unknown }).key)] = (
          entryValue as { value?: unknown }
        ).value;
        return acc;
      }
      acc[key] = entryValue;
      return acc;
    },
    {},
  );

  const avatarUrl = asString(
    fallbackValues.avatar_url ?? fallbackValues.avatarUrl ?? fallbackValues.avatar,
  );
  const twitterHandle = asString(
    fallbackValues.twitter_handle ?? fallbackValues.twitterHandle ?? fallbackValues.twitter,
  );
  const description = asString(
    fallbackValues.description ?? fallbackValues.bio ?? fallbackValues.summary,
  );
  const socials =
    typeof fallbackValues.socials === 'object' && fallbackValues.socials
      ? (fallbackValues.socials as Record<string, unknown>)
      : undefined;

  if (avatarUrl) metadata.avatar_url = avatarUrl;
  if (twitterHandle) metadata.twitter_handle = twitterHandle;
  if (description) metadata.description = description;
  if (socials) {
    metadata.socials = Object.fromEntries(
      Object.entries(socials)
        .filter(([, v]) => typeof v !== 'undefined' && v !== null)
        .map(([key, v]) => [key, asString(v) ?? String(v)]),
    );
  }

  return metadata;
}

function normalizeNameRecordResult(value: unknown, fallbackName: string): NameRecord | null {
  if (value === null || value === undefined || value === false) return null;

  const root = (() => {
    if (typeof value === 'object' && value && 'record' in value)
      return (value as { record: unknown }).record;
    if (typeof value === 'object' && value && 'result' in value)
      return (value as { result: unknown }).result;
    return value;
  })();

  if (!root || typeof root !== 'object') {
    if (typeof root === 'string' || typeof root === 'number' || typeof root === 'bigint') {
      return null;
    }
    return null;
  }

  const obj = root as Record<string, unknown>;
  const owner = asString(
    obj.owner ??
      obj.owner_address ??
      obj.ownerAddress ??
      obj.address ??
      obj.account ??
      obj.recipient,
  );
  const expiresAt = asNumber(
    obj.expires_at ?? obj.expiresAt ?? obj.expiration ?? obj.expiry ?? obj.expires,
  );

  const metadata = normalizeMetadataValue(obj.metadata ?? obj.meta ?? obj.attributes ?? obj);
  const name = asString(obj.name) || fallbackName;

  if (
    !owner &&
    !expiresAt &&
    !metadata.avatar_url &&
    !metadata.description &&
    !metadata.twitter_handle
  ) {
    if (Array.isArray(root)) {
      const first = root[0];
      if (first && typeof first === 'object') return normalizeNameRecordResult(first, fallbackName);
    }
    return null;
  }

  return {
    name,
    owner: owner || '',
    expires_at: expiresAt ? Math.floor(expiresAt) : 0,
    metadata,
  };
}

function parseSimulationReturnValue(value: unknown, fallbackName: string): NameRecord | null {
  if (!value || typeof value !== 'object') return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseSimulationReturnValue(item, fallbackName);
      if (parsed) return parsed;
    }
    return null;
  }

  if (value instanceof Map) {
    for (const entry of value.values()) {
      const parsed = parseSimulationReturnValue(entry, fallbackName);
      if (parsed) return parsed;
    }
    return null;
  }

  return normalizeNameRecordResult(value, fallbackName);
}

export interface NameAuction {
  name: string;
  commitEnd: number;
  revealEnd: number;
  highestBidder: string | null;
  highestAmount: bigint;
  settled: boolean;
}

export interface NameAuctionConfig {
  reservePrice: bigint;
  minBidIncrement: bigint;
  commitSecs: number;
  revealSecs: number;
}

export interface CommitBidParams {
  name: string;
  commitmentHex: string;
  deposit: bigint;
}

export interface RevealBidParams {
  name: string;
  amount: bigint;
  saltHex: string;
}

export const MIN_AUCTION_BID_INCREMENT = 1_000_000n; // 0.1 XLM in stroops

async function getSourceAccount(fromAddress: string) {
  const accountRes = await fetch(`${STELLAR_NETWORK.horizonUrl}/accounts/${fromAddress}`);
  if (!accountRes.ok) throw new Error('Failed to load account');
  const accountData = (await accountRes.json()) as { sequence: string };
  return new Account(fromAddress, accountData.sequence);
}

async function simulateRead<T>(operation: xdr.Operation): Promise<T> {
  const { rpc } = await import('@stellar/stellar-sdk');
  const server = new rpc.Server(STELLAR_NETWORK.rpcUrl);
  const tx = new TransactionBuilder(
    new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWH', '0'),
    { fee: '100', networkPassphrase: STELLAR_NETWORK.networkPassphrase },
  )
    .addOperation(operation)
    .setTimeout(30)
    .build();
  const simulation = await server.simulateTransaction(tx);
  if ('error' in simulation) throw new Error(simulation.error);
  if (!simulation.result) throw new Error('Contract returned no result');
  return scValToNative(simulation.result.retval) as T;
}

async function buildAuctionTransaction(fromAddress: string, operation: xdr.Operation) {
  const { rpc } = await import('@stellar/stellar-sdk');
  const server = new rpc.Server(STELLAR_NETWORK.rpcUrl);
  const sourceAccount = await getSourceAccount(fromAddress);
  const tx = new TransactionBuilder(sourceAccount, {
    fee: '100',
    networkPassphrase: STELLAR_NETWORK.networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();
  const simulation = await server.simulateTransaction(tx);
  if ('error' in simulation) throw new Error(simulation.error);
  return rpc.assembleTransaction(tx, simulation).build().toXDR();
}

function bytesScVal(hex: string) {
  const normalized = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-f]{64}$/i.test(normalized)) throw new Error('Expected a 32-byte hex value');
  return xdr.ScVal.scvBytes(Buffer.from(normalized, 'hex'));
}

function normalizeAuction(value: Record<string, unknown> | null): NameAuction | null {
  if (!value) return null;
  return {
    name: String(value.name ?? ''),
    commitEnd: Number(value.commit_end ?? 0),
    revealEnd: Number(value.reveal_end ?? 0),
    highestBidder: value.highest_bidder ? String(value.highest_bidder) : null,
    highestAmount: BigInt(String(value.highest_amount ?? 0)),
    settled: Boolean(value.settled),
  };
}

export async function getNameAuction(name: string): Promise<NameAuction | null> {
  const contract = new Contract(NAMES_CONTRACT_ID);
  const value = await simulateRead<Record<string, unknown> | null>(
    contract.call('get_auction', nativeToScVal(name.trim().toLowerCase())),
  );
  return normalizeAuction(value);
}

export async function getNameAuctionConfig(): Promise<NameAuctionConfig | null> {
  const contract = new Contract(NAMES_CONTRACT_ID);
  const value = await simulateRead<Record<string, unknown> | null>(contract.call('auction_config'));
  if (!value) return null;
  return {
    reservePrice: BigInt(String(value.reserve_price ?? 0)),
    minBidIncrement: BigInt(
      String(value.min_increment ?? value.min_bid_increment ?? MIN_AUCTION_BID_INCREMENT),
    ),
    commitSecs: Number(value.commit_secs ?? 0),
    revealSecs: Number(value.reveal_secs ?? 0),
  };
}

export async function getActiveNameAuctions(names: string[]): Promise<NameAuction[]> {
  const contract = new Contract(NAMES_CONTRACT_ID);
  try {
    const values = await simulateRead<Array<Record<string, unknown>>>(
      contract.call('get_active_auctions'),
    );
    if (Array.isArray(values)) {
      return values
        .map((value) => normalizeAuction(value))
        .filter((auction): auction is NameAuction => auction !== null);
    }
  } catch {
    // Current sealed-bid deployments expose lookup-by-name only. Fall back to
    // the locally tracked names while remaining compatible with enumerable ABIs.
  }

  const uniqueNames = [...new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean))];
  const auctions = await Promise.all(
    uniqueNames.map(async (name) => {
      try {
        return await getNameAuction(name);
      } catch {
        return null;
      }
    }),
  );
  return auctions.filter((auction): auction is NameAuction => auction !== null);
}

export async function computeNameBidCommitment(
  bidder: string,
  name: string,
  amount: bigint,
  saltHex: string,
): Promise<string> {
  const contract = new Contract(NAMES_CONTRACT_ID);
  const commitment = await simulateRead<Uint8Array>(
    contract.call(
      'compute_commitment',
      nativeToScVal(name.trim().toLowerCase()),
      new Address(bidder).toScVal(),
      nativeToScVal(amount, { type: 'i128' }),
      bytesScVal(saltHex),
    ),
  );
  return Buffer.from(commitment).toString('hex');
}

export async function buildCommitNameBidTransaction(
  bidder: string,
  params: CommitBidParams,
): Promise<string> {
  const contract = new Contract(NAMES_CONTRACT_ID);
  return buildAuctionTransaction(
    bidder,
    contract.call(
      'commit_bid',
      new Address(bidder).toScVal(),
      nativeToScVal(params.name.trim().toLowerCase()),
      bytesScVal(params.commitmentHex),
      nativeToScVal(params.deposit, { type: 'i128' }),
    ),
  );
}

export async function buildRevealNameBidTransaction(
  bidder: string,
  params: RevealBidParams,
): Promise<string> {
  const contract = new Contract(NAMES_CONTRACT_ID);
  return buildAuctionTransaction(
    bidder,
    contract.call(
      'reveal_bid',
      new Address(bidder).toScVal(),
      nativeToScVal(params.name.trim().toLowerCase()),
      nativeToScVal(params.amount, { type: 'i128' }),
      bytesScVal(params.saltHex),
    ),
  );
}

export async function buildSettleNameAuctionTransaction(fromAddress: string, name: string) {
  const contract = new Contract(NAMES_CONTRACT_ID);
  return buildAuctionTransaction(
    fromAddress,
    contract.call('settle_auction', nativeToScVal(name.trim().toLowerCase())),
  );
}

export async function buildRefundNameBidTransaction(bidder: string, name: string) {
  const contract = new Contract(NAMES_CONTRACT_ID);
  return buildAuctionTransaction(
    bidder,
    contract.call(
      'withdraw_bid',
      new Address(bidder).toScVal(),
      nativeToScVal(name.trim().toLowerCase()),
    ),
  );
}

export async function buildClaimAuctionNameTransaction(
  winner: string,
  name: string,
  stealthMetaAddress: Uint8Array,
) {
  if (stealthMetaAddress.length !== 64)
    throw new Error('A 64-byte stealth meta-address is required');
  const contract = new Contract(NAMES_CONTRACT_ID);
  return buildAuctionTransaction(
    winner,
    contract.call(
      'claim_name',
      new Address(winner).toScVal(),
      nativeToScVal(name.trim().toLowerCase()),
      xdr.ScVal.scvBytes(Buffer.from(stealthMetaAddress)),
    ),
  );
}

/**
 * Check if a name is available
 */
export async function checkAvailability(name: string): Promise<boolean> {
  try {
    const { rpc } = await import('@stellar/stellar-sdk');
    const server = new rpc.Server(STELLAR_NETWORK.rpcUrl);
    const contract = new Contract(NAMES_CONTRACT_ID);

    const result = await server.simulateTransaction(
      new TransactionBuilder(
        new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWH', '0'),
        {
          fee: '100',
          networkPassphrase: STELLAR_NETWORK.networkPassphrase,
        },
      )
        .addOperation(contract.call('get_owner', nativeToScVal(name)))
        .setTimeout(30)
        .build(),
    );

    if ('error' in result) return false;
    if (!result.result || !('retval' in result.result)) return true;

    const value = scValToNative(result.result.retval);
    if (value === null || value === undefined || value === false) return true;
    const owner = asString(value);
    return owner !== undefined && owner !== '' && owner !== 'void';
  } catch {
    return true;
  }
}

/**
 * Build a registration transaction
 */
export async function buildRegisterTransaction(
  fromAddress: string,
  params: RegistrationParams,
): Promise<string> {
  const horizonUrl = STELLAR_NETWORK.horizonUrl;
  const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

  const accountRes = await fetch(`${horizonUrl}/accounts/${fromAddress}`);
  if (!accountRes.ok) throw new Error('Failed to load account');
  const accountData = await accountRes.json();
  const sourceAccount = new Account(fromAddress, accountData.sequence);

  const contract = new Contract(NAMES_CONTRACT_ID);

  const tx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
    .addOperation(
      contract.call(
        'register',
        nativeToScVal(params.name),
        nativeToScVal(params.duration, { type: 'u64' }),
      ),
    )
    .setTimeout(30)
    .build();

  return tx.toXDR();
}

/**
 * Build a transfer transaction
 */
export async function buildTransferTransaction(
  fromAddress: string,
  params: TransferParams,
): Promise<string> {
  const horizonUrl = STELLAR_NETWORK.horizonUrl;
  const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

  const accountRes = await fetch(`${horizonUrl}/accounts/${fromAddress}`);
  if (!accountRes.ok) throw new Error('Failed to load account');
  const accountData = await accountRes.json();
  const sourceAccount = new Account(fromAddress, accountData.sequence);

  const contract = new Contract(NAMES_CONTRACT_ID);

  const tx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
    .addOperation(
      contract.call('transfer', nativeToScVal(params.name), new Address(params.to).toScVal()),
    )
    .setTimeout(30)
    .build();

  return tx.toXDR();
}

/**
 * Build a renewal transaction
 */
export async function buildRenewTransaction(
  fromAddress: string,
  params: RenewParams,
): Promise<string> {
  const horizonUrl = STELLAR_NETWORK.horizonUrl;
  const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

  const accountRes = await fetch(`${horizonUrl}/accounts/${fromAddress}`);
  if (!accountRes.ok) throw new Error('Failed to load account');
  const accountData = await accountRes.json();
  const sourceAccount = new Account(fromAddress, accountData.sequence);

  const contract = new Contract(NAMES_CONTRACT_ID);

  const tx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
    .addOperation(
      contract.call(
        'renew',
        nativeToScVal(params.name),
        nativeToScVal(params.duration, { type: 'u64' }),
      ),
    )
    .setTimeout(30)
    .build();

  return tx.toXDR();
}

/**
 * Build a metadata update transaction
 */
export async function buildSetMetadataTransaction(
  fromAddress: string,
  params: MetadataParams,
): Promise<string> {
  const horizonUrl = STELLAR_NETWORK.horizonUrl;
  const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

  const accountRes = await fetch(`${horizonUrl}/accounts/${fromAddress}`);
  if (!accountRes.ok) throw new Error('Failed to load account');
  const accountData = await accountRes.json();
  const sourceAccount = new Account(fromAddress, accountData.sequence);

  const contract = new Contract(NAMES_CONTRACT_ID);

  // Build metadata map
  const metadataMap: xdr.ScMapEntry[] = [
    new xdr.ScMapEntry({
      key: nativeToScVal('avatar_url'),
      val: params.metadata.avatar_url
        ? nativeToScVal(params.metadata.avatar_url)
        : xdr.ScVal.scvVoid(),
    }),
    new xdr.ScMapEntry({
      key: nativeToScVal('twitter_handle'),
      val: params.metadata.twitter_handle
        ? nativeToScVal(params.metadata.twitter_handle)
        : xdr.ScVal.scvVoid(),
    }),
    new xdr.ScMapEntry({
      key: nativeToScVal('description'),
      val: params.metadata.description
        ? nativeToScVal(params.metadata.description)
        : xdr.ScVal.scvVoid(),
    }),
  ];

  const tx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
    .addOperation(
      contract.call('set_metadata', nativeToScVal(params.name), xdr.ScVal.scvMap(metadataMap)),
    )
    .setTimeout(30)
    .build();

  return tx.toXDR();
}

/**
 * Get name record from contract
 */
export async function getNameRecord(name: string): Promise<NameRecord | null> {
  try {
    const { rpc } = await import('@stellar/stellar-sdk');
    const server = new rpc.Server(STELLAR_NETWORK.rpcUrl);
    const contract = new Contract(NAMES_CONTRACT_ID);

    const result = await server.simulateTransaction(
      new TransactionBuilder(
        new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWH', '0'),
        {
          fee: '100',
          networkPassphrase: STELLAR_NETWORK.networkPassphrase,
        },
      )
        .addOperation(contract.call('get_record', nativeToScVal(name)))
        .setTimeout(30)
        .build(),
    );

    if ('error' in result || !result.result || !('retval' in result.result)) {
      return null;
    }

    const nativeValue = scValToNative(result.result.retval);
    const parsed = parseSimulationReturnValue(nativeValue, name);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Get all names owned by an address
 */
export async function getOwnedNames(ownerAddress: string): Promise<string[]> {
  try {
    const { rpc } = await import('@stellar/stellar-sdk');
    const server = new rpc.Server(STELLAR_NETWORK.rpcUrl);
    const contract = new Contract(NAMES_CONTRACT_ID);

    const result = await server.simulateTransaction(
      new TransactionBuilder(
        new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWH', '0'),
        {
          fee: '100',
          networkPassphrase: STELLAR_NETWORK.networkPassphrase,
        },
      )
        .addOperation(contract.call('get_names_by_owner', new Address(ownerAddress).toScVal()))
        .setTimeout(30)
        .build(),
    );

    if ('error' in result || !result.result || !('retval' in result.result)) {
      return [];
    }

    const value = scValToNative(result.result.retval);
    if (Array.isArray(value)) {
      return value
        .map((entry) => asString(entry))
        .filter((entry): entry is string => Boolean(entry));
    }

    if (value instanceof Set) {
      return Array.from(value)
        .map((entry) => asString(entry))
        .filter((entry): entry is string => Boolean(entry));
    }

    if (value instanceof Map) {
      return Array.from(value.keys())
        .map((entry) => asString(entry))
        .filter((entry): entry is string => Boolean(entry));
    }

    return [];
  } catch {
    return [];
  }
}

/**
 * Submit a signed transaction to the network
 */
export async function submitTransaction(signedXdr: string): Promise<string> {
  const { rpc } = await import('@stellar/stellar-sdk');
  const server = new rpc.Server(STELLAR_NETWORK.rpcUrl);

  const tx = TransactionBuilder.fromXDR(signedXdr, STELLAR_NETWORK.networkPassphrase);
  const result = await server.sendTransaction(tx);

  if (result.status === 'ERROR') {
    throw new Error(result.errorResult?.toString() || 'Transaction failed');
  }

  return result.hash;
}
