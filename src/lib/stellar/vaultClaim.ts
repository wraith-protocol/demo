import {
  Account,
  Address,
  Asset,
  Contract,
  TransactionBuilder,
  authorizeEntry,
  hash as sha256,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import {
  checkStealthAddress,
  fetchAnnouncements,
  hexToBytes,
  bytesToHex,
  signStellarTransaction,
  L,
  type Announcement,
} from '@wraith-protocol/sdk/chains/stellar';
import { STELLAR_NETWORK } from '@/config';
import { STELLAR_USDC } from '@/lib/stellar/assets';
import {
  isBoundedString,
  isFiniteTimestamp,
  readVersionedCollection,
  writeVersioned,
} from '@/lib/versionedStorage';

/** Scheme ID the stealth-vault contract announces deposits under (distinct from the direct-transfer scheme). */
export const VAULT_ANNOUNCE_SCHEME_ID = 2;

const CONTRACT_ERROR_PATTERN = /Error\(Contract, #(\d+)\)/;
const RECIPIENT_DEPOSIT_STORAGE_PREFIX = 'wraith:stellar-vault-recipient-deposits';

type VaultStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface PersistedRecipientVaultDeposit {
  depositId: string;
  recipient: string;
  ephemeralPubKey: string;
  metadata: string;
  discoveredAt: number;
}

function isHex(value: string, byteLength?: number): boolean {
  return (
    value.length % 2 === 0 &&
    (byteLength === undefined || value.length === byteLength * 2) &&
    /^[0-9a-f]+$/i.test(value)
  );
}

function isPersistedRecipientVaultDeposit(value: unknown): value is PersistedRecipientVaultDeposit {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<PersistedRecipientVaultDeposit>;
  return (
    isBoundedString(record.depositId, 64) &&
    isHex(record.depositId, 32) &&
    isBoundedString(record.recipient, 56) &&
    /^G[A-Z2-7]{55}$/.test(record.recipient) === true &&
    isBoundedString(record.ephemeralPubKey, 64) &&
    isHex(record.ephemeralPubKey, 32) &&
    isBoundedString(record.metadata, 512) &&
    isHex(record.metadata) &&
    isFiniteTimestamp(record.discoveredAt)
  );
}

export function recipientVaultStorageKey(
  sourceAddress: string,
  vaultContractId: string,
  networkPassphrase: string,
): string {
  const networkId = sha256(Buffer.from(networkPassphrase)).subarray(0, 8).toString('hex');
  return `${RECIPIENT_DEPOSIT_STORAGE_PREFIX}:${networkId}:${vaultContractId}:${sourceAddress}`;
}

export function loadPersistedRecipientVaultDeposits(
  storage: VaultStorage,
  sourceAddress: string,
  vaultContractId: string,
  networkPassphrase: string,
): PersistedRecipientVaultDeposit[] {
  return readVersionedCollection(
    storage,
    recipientVaultStorageKey(sourceAddress, vaultContractId, networkPassphrase),
    isPersistedRecipientVaultDeposit,
  );
}

function savePersistedRecipientVaultDeposits(
  storage: VaultStorage,
  sourceAddress: string,
  vaultContractId: string,
  networkPassphrase: string,
  deposits: PersistedRecipientVaultDeposit[],
): void {
  writeVersioned(
    storage,
    recipientVaultStorageKey(sourceAddress, vaultContractId, networkPassphrase),
    deposits,
  );
}

function browserStorage(): VaultStorage | null {
  return typeof localStorage === 'undefined' ? null : localStorage;
}

// Mirrors the VaultError enum documented in the stealth-vault contract README.
const VAULT_ERROR_MESSAGES: Record<number, string> = {
  1: 'Vault contract is already initialized.',
  2: 'Vault contract is not initialized.',
  3: 'Invalid deposit window.',
  4: 'Deposit not found — it has likely already been claimed or refunded.',
  5: 'This deposit has not reached its unlock ledger yet.',
  6: 'This deposit has not reached its refund ledger yet.',
  7: 'This deposit does not belong to your derived stealth address.',
  8: 'The vault is currently paused for new deposits.',
  9: 'The permissionless refund window has not opened yet.',
  10: 'Invalid grace period.',
};

export function decodeVaultError(message: string): string {
  const match = message.match(CONTRACT_ERROR_PATTERN);
  if (match) {
    const code = Number(match[1]);
    return VAULT_ERROR_MESSAGES[code] || `Soroban vault error #${code}`;
  }
  return message.replace(/^Error:\s*/i, '');
}

export interface MatchedVaultAnnouncement {
  stealthAddress: string;
  ephemeralPubKey: string;
  metadata: string;
  stealthPrivateScalar: bigint;
  stealthPubKeyBytes: Uint8Array;
}

/**
 * Scans announcer events for stealth-vault deposits (scheme 2) belonging to the
 * recipient. The SDK's `scanAnnouncements` only matches scheme 1 (direct
 * transfers), so vault deposits need their own pass over the same ECDH check.
 */
export function scanVaultAnnouncements(
  announcements: Announcement[],
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  spendingScalar: bigint,
): MatchedVaultAnnouncement[] {
  const matched: MatchedVaultAnnouncement[] = [];

  for (const ann of announcements) {
    if (ann.schemeId !== VAULT_ANNOUNCE_SCHEME_ID) continue;

    const metadataBytes = hexToBytes(ann.metadata);
    if (metadataBytes.length === 0) continue;
    const viewTag = metadataBytes[0];

    const ephPubKey = hexToBytes(ann.ephemeralPubKey);
    if (ephPubKey.length !== 32) continue;

    const result = checkStealthAddress(ephPubKey, viewingKey, spendingPubKey, viewTag);
    if (
      result.isMatch &&
      result.stealthAddress === ann.stealthAddress &&
      result.hashScalar !== null &&
      result.stealthPubKeyBytes !== null
    ) {
      matched.push({
        stealthAddress: ann.stealthAddress,
        ephemeralPubKey: ann.ephemeralPubKey,
        metadata: ann.metadata,
        stealthPrivateScalar: (spendingScalar + result.hashScalar) % L,
        stealthPubKeyBytes: result.stealthPubKeyBytes,
      });
    }
  }

  return matched;
}

export interface VaultDepositEvent {
  depositId: string;
  sender: string;
  amount: bigint;
  asset: string;
  unlockLedger: number;
}

function parseVaultDepositEvent(event: Record<string, unknown>): VaultDepositEvent | null {
  const topics = event.topic as string[];
  if (!topics || topics.length < 2) return null;

  const depositIdScVal = xdr.ScVal.fromXDR(topics[1], 'base64');
  const depositIdBytes = depositIdScVal.bytes();
  if (!depositIdBytes) return null;

  const valueScVal = xdr.ScVal.fromXDR(event.value as string, 'base64');
  const valueVec = valueScVal.vec();
  if (!valueVec || valueVec.length < 4) return null;

  return {
    depositId: bytesToHex(new Uint8Array(depositIdBytes)),
    sender: scValToNative(valueVec[0]) as string,
    amount: scValToNative(valueVec[1]) as bigint,
    asset: scValToNative(valueVec[2]) as string,
    unlockLedger: scValToNative(valueVec[3]) as number,
  };
}

/**
 * Fetches every `deposit` event emitted by the stealth-vault contract via the
 * Soroban RPC `getEvents` method. Mirrors the probe/pagination pattern already
 * used for announcer events elsewhere in this codebase.
 */
export async function fetchVaultDepositEvents(
  rpcUrl: string,
  vaultContractId: string,
): Promise<VaultDepositEvent[]> {
  const all: VaultDepositEvent[] = [];
  const depositTopic = xdr.ScVal.scvSymbol('deposit').toXDR('base64');
  const contractFilter = {
    type: 'contract',
    contractIds: [vaultContractId],
    topics: [[depositTopic, '*']],
  };

  try {
    let startLedger = 1;
    const probeRes = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 0,
        method: 'getEvents',
        params: { startLedger: 1, filters: [contractFilter], pagination: { limit: 1 } },
      }),
    });
    const probeData = await probeRes.json();

    if (probeData.error?.message) {
      const match = probeData.error.message.match(/range:\s*(\d+)\s*-\s*(\d+)/);
      if (match) {
        const oldest = parseInt(match[1], 10);
        const latest = parseInt(match[2], 10);
        startLedger = Math.max(oldest, latest - 5000);
      } else {
        return all;
      }
    }

    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const pagination: Record<string, unknown> = { limit: 1000 };
      if (cursor) {
        pagination.cursor = cursor;
      }

      const params: Record<string, unknown> = {
        filters: [contractFilter],
        pagination,
      };
      if (!cursor) {
        params.startLedger = startLedger;
      }

      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'getEvents', params }),
      });

      const data = await res.json();
      const events = (data.result?.events ?? []) as Record<string, unknown>[];

      for (const event of events) {
        try {
          const parsed = parseVaultDepositEvent(event);
          if (parsed) all.push(parsed);
        } catch {
          // Skip malformed
        }
      }

      if (events.length < 1000) {
        hasMore = false;
      } else {
        cursor = data.result?.cursor as string | undefined;
        if (!cursor) hasMore = false;
      }
    }
  } catch {
    // Events API may not be available
  }

  return all;
}

export interface VaultDepositEntry {
  sender: string;
  recipient: string;
  amount: bigint;
  asset: string;
  unlockLedger: number;
  refundAfter: number;
}

/**
 * Reads a single deposit's current on-chain state via a simulated `get_deposit`
 * call. Returns `null` when the deposit no longer exists — the contract removes
 * the storage entry on both the claim and refund exit paths.
 */
export async function getVaultDeposit(
  soroban: { simulateTransaction(transaction: unknown): Promise<rpc.SimulateTransactionResponse> },
  readAccount: Account,
  networkPassphrase: string,
  vaultContractId: string,
  depositId: string,
): Promise<VaultDepositEntry | null> {
  const contract = new Contract(vaultContractId);
  const tx = new TransactionBuilder(readAccount, { fee: '100', networkPassphrase })
    .addOperation(
      contract.call('get_deposit', xdr.ScVal.scvBytes(Buffer.from(hexToBytes(depositId)))),
    )
    .setTimeout(30)
    .build();

  const simulation = await soroban.simulateTransaction(tx);

  if ('error' in simulation) {
    if (CONTRACT_ERROR_PATTERN.test(simulation.error)) return null;
    throw new Error(decodeVaultError(simulation.error));
  }
  if (!simulation.result) return null;

  const native = scValToNative(simulation.result.retval) as {
    sender: string;
    recipient: string;
    amount: bigint;
    asset: string;
    unlock_ledger: number;
    refund_after: number;
  };

  return {
    sender: native.sender,
    recipient: native.recipient,
    amount: native.amount,
    asset: native.asset,
    unlockLedger: native.unlock_ledger,
    refundAfter: native.refund_after,
  };
}

function describeVaultAsset(
  assetContractId: string,
  networkPassphrase: string,
): { label: string; decimals: number } {
  if (assetContractId === Asset.native().contractId(networkPassphrase)) {
    return { label: 'XLM', decimals: 7 };
  }
  if (
    assetContractId ===
    new Asset(STELLAR_USDC.code, STELLAR_USDC.issuer).contractId(networkPassphrase)
  ) {
    return { label: 'USDC', decimals: 7 };
  }
  return { label: `${assetContractId.slice(0, 4)}…${assetContractId.slice(-4)}`, decimals: 7 };
}

/** Formats a raw i128 vault amount into a human decimal string. */
export function formatVaultAmount(amount: bigint, decimals: number): string {
  const negative = amount < 0n || amount === 0n;
  const abs = negative ? -amount : amount;
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const fracDigits = (abs % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  const formatted = fracDigits.length > 0 ? `${whole}.${fracDigits}` : whole.toString();
  return negative ? `-${formatted}` : formatted;
}

export interface ClaimableVaultDeposit {
  depositId: string;
  recipient: string;
  sender: string;
  amount: bigint;
  assetLabel: string;
  assetDecimals: number;
  unlockLedger: number;
  refundAfter: number;
}
