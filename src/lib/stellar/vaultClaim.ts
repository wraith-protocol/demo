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
} from '@wraith-protocol/sdk/chains/stellar';
import type { Announcement } from '@wraith-protocol/sdk/chains/stellar';
import { STELLAR_NETWORK } from '@/config';
import { STELLAR_USDC } from '@/lib/stellar/assets';
import { fetchEventPages, type StellarRpcEvent } from '@/lib/stellar/rpcEvents';
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
    /^G[A-Z2-7]{55}$/.test(record.recipient) &&
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

function parseVaultDepositEvent(
  event: StellarRpcEvent | Record<string, unknown>,
): VaultDepositEvent | null {
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
 * Fetches every `deposit` event emitted by the stealth-vault contract. Reads go
 * through the shared paginated `getEvents` implementation so the vault flow
 * gets the same cursor, timeout and response-validation rules as the announcer
 * scans. Still best-effort: an unavailable events API yields an empty list.
 */
export async function fetchVaultDepositEvents(
  rpcUrl: string,
  vaultContractId: string,
): Promise<VaultDepositEvent[]> {
  const all: VaultDepositEvent[] = [];
  const depositTopic = xdr.ScVal.scvSymbol('deposit').toXDR('base64');

  try {
    await fetchEventPages({
      rpcUrl,
      contractId: vaultContractId,
      filters: [
        {
          type: 'contract',
          contractIds: [vaultContractId],
          topics: [[depositTopic, '*']],
        },
      ],
      onPage: (page) => {
        for (const event of page.events) {
          try {
            const parsed = parseVaultDepositEvent(event);
            if (parsed) all.push(parsed);
          } catch {
            // Skip malformed
          }
        }
      },
    });
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
  soroban: { simulateTransaction(transaction: unknown): Promise<any> },
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
  const negative = amount < 0n;
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
  isUnlocked: boolean;
  isRefundable: boolean;
  stealthPrivateScalar: bigint;
  stealthPubKeyBytes: Uint8Array;
}

type VaultClaimReadServer = {
  getLatestLedger(): Promise<{ sequence: number }>;
  getAccount(address: string): Promise<Account>;
  simulateTransaction(transaction: unknown): Promise<any>;
};

function persistedRecordToAnnouncement(record: PersistedRecipientVaultDeposit): Announcement {
  return {
    schemeId: VAULT_ANNOUNCE_SCHEME_ID,
    stealthAddress: record.recipient,
    caller: record.recipient,
    ephemeralPubKey: record.ephemeralPubKey,
    metadata: record.metadata,
  };
}

/**
 * Discovers deposits claimable by the connected recipient. Public match data
 * is persisted so active deposits remain discoverable after their announcement
 * and deposit events leave the RPC retention window. Every candidate is
 * confirmed with `get_deposit`; claimed/refunded entries are removed from the
 * cache when the contract no longer returns them.
 */
export async function loadClaimableVaultDeposits(params: {
  vaultContractId: string;
  sourceAddress: string;
  viewingKey: Uint8Array;
  spendingPubKey: Uint8Array;
  spendingScalar: bigint;
  rpcUrl?: string;
  networkPassphrase?: string;
  fetchAnnouncementsFn?: () => Promise<Announcement[]>;
  fetchDepositEventsFn?: () => Promise<VaultDepositEvent[]>;
  server?: VaultClaimReadServer;
  storage?: VaultStorage | null;
}): Promise<{ deposits: ClaimableVaultDeposit[]; currentLedger: number }> {
  const {
    vaultContractId,
    sourceAddress,
    viewingKey,
    spendingPubKey,
    spendingScalar,
    rpcUrl = STELLAR_NETWORK.rpcUrl,
    networkPassphrase = STELLAR_NETWORK.networkPassphrase,
    fetchAnnouncementsFn = () => fetchAnnouncements('stellar', rpcUrl),
    fetchDepositEventsFn = () => fetchVaultDepositEvents(rpcUrl, vaultContractId),
    server,
    storage = browserStorage(),
  } = params;

  const soroban = server ?? new rpc.Server(rpcUrl);
  const persisted = storage
    ? loadPersistedRecipientVaultDeposits(
        storage,
        sourceAddress,
        vaultContractId,
        networkPassphrase,
      )
    : [];

  const [announcements, depositEvents, latestLedger, account] = await Promise.all([
    fetchAnnouncementsFn(),
    fetchDepositEventsFn(),
    soroban.getLatestLedger(),
    soroban.getAccount(sourceAddress),
  ]);

  const currentLedger = latestLedger.sequence;
  const matches = scanVaultAnnouncements(
    [...announcements, ...persisted.map(persistedRecordToAnnouncement)],
    viewingKey,
    spendingPubKey,
    spendingScalar,
  );

  const matchByAddress = new Map(matches.map((m) => [m.stealthAddress, m]));
  const persistedById = new Map(persisted.map((record) => [record.depositId, record]));
  const candidateIds = new Set([
    ...depositEvents.map((event) => event.depositId),
    ...persisted.map((record) => record.depositId),
  ]);
  const deposits: ClaimableVaultDeposit[] = [];

  for (const depositId of candidateIds) {
    const readAccount = new Account(account.accountId(), account.sequenceNumber());
    let entry: VaultDepositEntry | null;
    try {
      entry = await getVaultDeposit(
        soroban,
        readAccount,
        networkPassphrase,
        vaultContractId,
        depositId,
      );
    } catch {
      continue;
    }
    if (!entry) {
      persistedById.delete(depositId);
      continue;
    }

    const match = matchByAddress.get(entry.recipient);
    if (!match) continue;

    persistedById.set(depositId, {
      depositId,
      recipient: entry.recipient,
      ephemeralPubKey: match.ephemeralPubKey,
      metadata: match.metadata,
      discoveredAt: persistedById.get(depositId)?.discoveredAt ?? Date.now(),
    });

    const { label, decimals } = describeVaultAsset(entry.asset, networkPassphrase);

    deposits.push({
      depositId,
      recipient: entry.recipient,
      sender: entry.sender,
      amount: entry.amount,
      assetLabel: label,
      assetDecimals: decimals,
      unlockLedger: entry.unlockLedger,
      refundAfter: entry.refundAfter,
      isUnlocked: currentLedger >= entry.unlockLedger,
      isRefundable: currentLedger >= entry.refundAfter,
      stealthPrivateScalar: match.stealthPrivateScalar,
      stealthPubKeyBytes: match.stealthPubKeyBytes,
    });
  }

  if (storage) {
    savePersistedRecipientVaultDeposits(
      storage,
      sourceAddress,
      vaultContractId,
      networkPassphrase,
      Array.from(persistedById.values()),
    );
  }

  return { deposits, currentLedger };
}

export interface VaultClaimResult {
  txHash: string;
}

/**
 * Polls until the submitted claim transaction reaches a terminal on-chain
 * status. Resolves only on `SUCCESS`; a timeout (still `NOT_FOUND` after all
 * attempts) is reported as pending, not success — the transaction may yet
 * land, but we cannot confirm that here.
 */
export async function awaitVaultClaimConfirmation(
  soroban: Pick<rpc.Server, 'getTransaction'>,
  txHash: string,
  opts: { maxAttempts?: number; delayMs?: number } = {},
): Promise<void> {
  const { maxAttempts = 30, delayMs = 1000 } = opts;

  let result = await soroban.getTransaction(txHash);
  let attempts = 1;

  while (result.status === 'NOT_FOUND' && attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    result = await soroban.getTransaction(txHash);
    attempts++;
  }

  if (result.status === 'SUCCESS') return;

  if (result.status === 'FAILED') {
    throw new Error(
      'Claim transaction failed on-chain — it may have already been claimed or refunded.',
    );
  }

  throw new Error(
    `Claim transaction ${txHash} was submitted but has not confirmed yet — check its status on Stellar Expert before retrying to avoid a duplicate claim attempt.`,
  );
}

/**
 * Builds, authorizes, and submits a real `claim` invocation. The connected
 * wallet pays the fee as the transaction source; the recipient's derived
 * stealth key separately authorizes the `recipient.require_auth()` the
 * contract requires, via a signed Soroban authorization entry.
 */
export async function submitVaultClaim(params: {
  vaultContractId: string;
  sourceAddress: string;
  deposit: Pick<
    ClaimableVaultDeposit,
    'depositId' | 'recipient' | 'stealthPrivateScalar' | 'stealthPubKeyBytes'
  >;
  signWalletTransaction: (xdr: string) => Promise<string>;
  rpcUrl?: string;
  networkPassphrase?: string;
}): Promise<VaultClaimResult> {
  const {
    vaultContractId,
    sourceAddress,
    deposit,
    signWalletTransaction,
    rpcUrl = STELLAR_NETWORK.rpcUrl,
    networkPassphrase = STELLAR_NETWORK.networkPassphrase,
  } = params;

  const soroban = new rpc.Server(rpcUrl);
  const accountResponse = await soroban.getAccount(sourceAddress);
  const sourceAccount = new Account(accountResponse.accountId(), accountResponse.sequenceNumber());

  const contract = new Contract(vaultContractId);
  const tx = new TransactionBuilder(sourceAccount, { fee: '10000', networkPassphrase })
    .addOperation(
      contract.call(
        'claim',
        xdr.ScVal.scvBytes(Buffer.from(hexToBytes(deposit.depositId))),
        new Address(deposit.recipient).toScVal(),
      ),
    )
    .setTimeout(30)
    .build();

  const simulation = await soroban.simulateTransaction(tx);
  if ('error' in simulation) {
    throw new Error(decodeVaultError(simulation.error));
  }
  if (!simulation.result) {
    throw new Error('Simulation returned no result');
  }

  const latestLedger = await soroban.getLatestLedger();
  const validUntilLedgerSeq = latestLedger.sequence + 60;

  simulation.result.auth = await Promise.all(
    simulation.result.auth.map(async (entry) => {
      const credentials = entry.credentials();
      if (credentials.switch().name !== 'sorobanCredentialsAddress') return entry;

      const entryAddress = Address.fromScAddress(credentials.address().address()).toString();
      if (entryAddress !== deposit.recipient) return entry;

      return authorizeEntry(
        entry,
        async (preimage) => {
          const payloadHash = sha256(preimage.toXDR());
          const signature = signStellarTransaction(
            payloadHash,
            deposit.stealthPrivateScalar,
            deposit.stealthPubKeyBytes,
          );
          return { signature: Buffer.from(signature), publicKey: deposit.recipient };
        },
        validUntilLedgerSeq,
        networkPassphrase,
      );
    }),
  );

  const assembled = rpc.assembleTransaction(tx, simulation).build();
  const signedXdr = await signWalletTransaction(assembled.toXDR());
  const response = await soroban.sendTransaction(
    TransactionBuilder.fromXDR(signedXdr, networkPassphrase),
  );

  if (response.status === 'ERROR') {
    throw new Error('Claim transaction submission failed');
  }

  const txHash = response.hash;
  await awaitVaultClaimConfirmation(soroban, txHash);

  return { txHash };
}
