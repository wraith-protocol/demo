import { sha256 } from '@noble/hashes/sha256';
import {
  OFFLINE_QUEUE_STORAGE_KEY,
  loadOfflineQueue,
  saveOfflineQueue,
  type OfflineQueueEntry,
  type PaymentIntentPayload,
  type SignedSubmitPayload,
} from '@/lib/offlineQueue';
import { STELLAR_NETWORKS, getStellarNetworkConfig } from '@/lib/stellar/deployments';
import { scanCursorKey } from '@/lib/stellar/scannerCursor';
import { CACHE_PREFIX } from '@/lib/swCache';

/**
 * Wallet/network-scoped inventory, export and deletion of everything this app
 * keeps on the device: localStorage, IndexedDB, Cache Storage and the records
 * the service worker owns.
 *
 * Each store keeps its own key and its own scoping. Some are keyed by wallet,
 * some by wallet and network, some only carry the wallet as a field, and a few
 * are device-wide. This module is the one place that maps them all to a
 * (chain, network, wallet) scope, so a deletion for one wallet never touches
 * another wallet or network.
 *
 * Safety rules enforced here, not only in the UI:
 * - Ordinary exports never contain secrets or encrypted payloads. Those are
 *   listed under `withheld` together with the recovery flow that handles them.
 * - A deletion that would drop a signed-but-unbroadcast envelope, or a
 *   transaction whose outcome is unknown, is refused until each such record is
 *   explicitly resolved (see `LocalDataBlockedError`).
 * - Every deletion re-reads the stores afterwards and reports what is left.
 */

export const LOCAL_DATA_EXPORT_TYPE = 'wraith-local-data-export';
export const LOCAL_DATA_EXPORT_SCHEMA_VERSION = 1;
/** Text the user must type to confirm a full local reset. */
export const FULL_RESET_CONFIRMATION = 'RESET';

export const WALLET_CATEGORY_IDS = [
  'labels',
  'scan-cursor',
  'activity',
  'offline-intents',
  'pending-submissions',
  'vault-metadata',
  'service-worker',
  'cached-responses',
] as const;

export const DEVICE_CATEGORY_IDS = [
  'contacts',
  'name-history',
  'split-templates',
  'schedules',
  'notifications',
  'auction-data',
  'key-vault',
  'wallet-connection',
  'push-subscriptions',
  'unlinked-records',
  'preferences',
  'other-app-data',
] as const;

export type WalletCategoryId = (typeof WALLET_CATEGORY_IDS)[number];
export type DeviceCategoryId = (typeof DEVICE_CATEGORY_IDS)[number];
export type LocalDataCategoryId = WalletCategoryId | DeviceCategoryId;

export type ExportMode = 'full' | 'redacted' | 'withheld';

export interface WithheldDisclosure {
  id: LocalDataCategoryId;
  reason: 'secret' | 'encrypted';
  description: string;
  recoveryFlow?: string;
}

export interface CategoryDefinition {
  id: LocalDataCategoryId;
  scope: 'wallet' | 'device';
  label: string;
  description: string;
  exportMode: ExportMode;
  /** Fields removed from each exported record. */
  redactedFields: string[];
  /** Parts of the category that never appear in an ordinary export. */
  withheld?: Omit<WithheldDisclosure, 'id'>;
}

const STEALTH_KEYS_RECOVERY =
  'Re-derive stealth keys by signing in with your wallet on the Receive page.';

export const CATEGORY_DEFINITIONS: Record<LocalDataCategoryId, CategoryDefinition> = {
  labels: {
    id: 'labels',
    scope: 'wallet',
    label: 'Stealth address labels',
    description: 'Names, tags and hidden flags you gave to received stealth addresses.',
    exportMode: 'full',
    redactedFields: [],
  },
  'scan-cursor': {
    id: 'scan-cursor',
    scope: 'wallet',
    label: 'Scanner cursor',
    description: 'The ledger the payment scanner resumes from.',
    exportMode: 'full',
    redactedFields: [],
  },
  activity: {
    id: 'activity',
    scope: 'wallet',
    label: 'Cached activity',
    description: 'Sends, receives, withdrawals and claims recorded on this device.',
    exportMode: 'full',
    redactedFields: [],
  },
  'offline-intents': {
    id: 'offline-intents',
    scope: 'wallet',
    label: 'Offline intents',
    description: 'Payments and signed transactions queued while offline.',
    exportMode: 'redacted',
    redactedFields: ['payload.signedXdr'],
  },
  'pending-submissions': {
    id: 'pending-submissions',
    scope: 'wallet',
    label: 'Submission retry records',
    description: 'Operation IDs that stop a transaction from being submitted twice.',
    exportMode: 'redacted',
    redactedFields: ['signedEnvelope'],
  },
  'vault-metadata': {
    id: 'vault-metadata',
    scope: 'wallet',
    label: 'Vault metadata',
    description: 'Stealth vault deposits you sent or discovered on this network.',
    exportMode: 'full',
    redactedFields: [],
  },
  'service-worker': {
    id: 'service-worker',
    scope: 'wallet',
    label: 'Background scanning',
    description: 'The service worker account record and the sealed background-scan key.',
    exportMode: 'redacted',
    redactedFields: [],
    withheld: {
      reason: 'encrypted',
      description: 'Sealed background-scan key and its wrapping key.',
      recoveryFlow: STEALTH_KEYS_RECOVERY,
    },
  },
  'cached-responses': {
    id: 'cached-responses',
    scope: 'wallet',
    label: 'Cached network responses',
    description: 'Service worker cache entries for requests that name this wallet.',
    exportMode: 'redacted',
    redactedFields: ['response'],
  },
  contacts: {
    id: 'contacts',
    scope: 'device',
    label: 'Contacts',
    description: 'Your address book. Shared by every wallet on this device.',
    exportMode: 'full',
    redactedFields: [],
  },
  'name-history': {
    id: 'name-history',
    scope: 'device',
    label: 'Recent recipients',
    description: 'Recipients you sent to recently.',
    exportMode: 'full',
    redactedFields: [],
  },
  'split-templates': {
    id: 'split-templates',
    scope: 'device',
    label: 'Split templates',
    description: 'Saved batch-payment templates.',
    exportMode: 'full',
    redactedFields: [],
  },
  schedules: {
    id: 'schedules',
    scope: 'device',
    label: 'Payment schedules',
    description: 'Recurring payment schedules.',
    exportMode: 'full',
    redactedFields: [],
  },
  notifications: {
    id: 'notifications',
    scope: 'device',
    label: 'Notifications',
    description: 'The in-app notification inbox and the duplicate-push guard.',
    exportMode: 'full',
    redactedFields: [],
  },
  'auction-data': {
    id: 'auction-data',
    scope: 'device',
    label: 'Name auction data',
    description: 'Watched name auctions and the encrypted bid recovery vault.',
    exportMode: 'redacted',
    redactedFields: [],
    withheld: {
      reason: 'encrypted',
      description: 'Bid recovery material (encrypted vault and any legacy plaintext bids).',
      recoveryFlow: 'Names → Auctions → Export encrypted backup.',
    },
  },
  'key-vault': {
    id: 'key-vault',
    scope: 'device',
    label: 'Key vault',
    description: 'Passphrase-encrypted key vault entries.',
    exportMode: 'withheld',
    redactedFields: [],
    withheld: {
      reason: 'encrypted',
      description: 'Passphrase-encrypted key vault entries and their verifier.',
      recoveryFlow: STEALTH_KEYS_RECOVERY,
    },
  },
  'wallet-connection': {
    id: 'wallet-connection',
    scope: 'device',
    label: 'Wallet connection',
    description: 'The remembered Stellar wallet and passkey registration.',
    exportMode: 'full',
    redactedFields: [],
  },
  'push-subscriptions': {
    id: 'push-subscriptions',
    scope: 'device',
    label: 'Push subscriptions',
    description: 'Web Push endpoint and keys registered with the notification relay.',
    exportMode: 'withheld',
    redactedFields: [],
    withheld: {
      reason: 'secret',
      description: 'Web Push endpoint and encryption keys.',
    },
  },
  'unlinked-records': {
    id: 'unlinked-records',
    scope: 'device',
    label: 'Records not linked to a wallet',
    description: 'Offline scans and older queue, retry or activity records with no wallet tag.',
    exportMode: 'redacted',
    redactedFields: ['payload.signedXdr', 'signedEnvelope'],
  },
  preferences: {
    id: 'preferences',
    scope: 'device',
    label: 'Preferences',
    description: 'Theme, language, scanning strategy, consent and dismissed prompts.',
    exportMode: 'full',
    redactedFields: [],
  },
  'other-app-data': {
    id: 'other-app-data',
    scope: 'device',
    label: 'Other app data',
    description: 'Wraith keys this version does not recognise. Only key names are exported.',
    exportMode: 'redacted',
    redactedFields: ['value'],
  },
};

/** localStorage keys and prefixes owned by the app's stores. */
export const LOCAL_DATA_STORAGE_KEYS = {
  activity: 'wraith-activity-storage',
  offlineQueue: OFFLINE_QUEUE_STORAGE_KEY,
  submissions: 'wraith-submission-idempotency-v1',
  scanCursorPrefix: scanCursorKey(''),
  vaultSentPrefix: 'wraith:stellar-vault-deposits:v1:',
  vaultReceivedPrefix: 'wraith:stellar-vault-recipient-deposits:',
  contacts: 'wraith-contacts',
  nameHistory: 'wraith-name-history',
  splitTemplates: 'wraith-split-templates',
  schedules: 'wraith-schedule-storage',
  notifications: 'wraith-notifications-storage',
  auction: 'wraith-name-auction-watchlist',
  auctionVault: 'wraith-name-auction-watchlist.vault',
} as const;

const WALLET_CONNECTION_KEYS = [
  'wraith:stellar:wallet',
  'wraith:stellar:pubkey',
  'wraith:stellar:network',
  'wraith:passkey:credentialId',
  'wraith:passkey:address',
  'wraith:passkey:publicKey',
  'wraith:passkey:publicKeyAlgorithm',
  'wraith:passkey:signCount',
];

const PREFERENCE_KEYS = [
  'wraith-theme',
  'wraith-locale',
  'wraith-scan-strategy',
  'wraith-scanning-strategy',
  'wraith-telemetry-consent',
  'wraith-tour-dismissed',
  'wraith:pwa-install-dismissed',
  'wraith:labels:privacy-warning-shown',
  'wraith:stellar:notifications-opt-in',
  'wraith:push-relay-url',
  'wraith:push-subscribed',
];

/** IndexedDB databases and object stores owned by the app. */
export const LOCAL_DATA_DATABASES = {
  worker: {
    name: 'wraith-stellar-notifications',
    accounts: 'viewing-keys',
    notificationIds: 'notification-events',
  },
  scanKeys: { name: 'wraith-scan-keys', sealed: 'sealed-keys', wrapping: 'wrapping-keys' },
  keyVault: { name: 'wraith-key-vault', entries: 'entries', metadata: 'metadata' },
} as const;

const NON_STELLAR_NETWORKS: Record<string, string> = {
  horizen: 'horizen-testnet',
  solana: 'solana-devnet',
  ckb: 'ckb-testnet',
};

const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/;
/** Shorter strings are too likely to collide with unrelated URL text. */
const MIN_CACHE_MATCH_TOKEN = 16;

// ─── Backends ──────────────────────────────────────────────────────────────────

export type LocalStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key'> & {
  readonly length: number;
};

export interface IdbEntry {
  key: string;
  value: unknown;
}

/** Reads and deletes records in databases that already exist; never creates one. */
export interface LocalDataIdb {
  entries(database: string, store: string): Promise<IdbEntry[]>;
  delete(database: string, store: string, keys: string[]): Promise<void>;
  clear(database: string, store: string): Promise<void>;
}

export interface LocalDataCaches {
  names(): Promise<string[]>;
  urls(cacheName: string): Promise<string[]>;
  deleteUrls(cacheName: string, urls: string[]): Promise<void>;
  deleteCache(cacheName: string): Promise<void>;
}

export type WorkerClearRequest = { scope: 'wallet'; publicKey: string } | { scope: 'all' };

export interface LocalDataWorker {
  /** Resolves true once an active service worker acknowledged the request. */
  clear(request: WorkerClearRequest): Promise<boolean>;
  /** Drops the browser's Web Push subscription. Resolves true if one existed. */
  unsubscribePush(): Promise<boolean>;
}

export interface LocalDataBackends {
  storage: LocalStorageLike;
  idb: LocalDataIdb;
  caches: LocalDataCaches;
  worker: LocalDataWorker;
  /** Serialises read-modify-write of a shared store with other tabs. */
  withLock?: <T>(name: string, work: () => Promise<T>) => Promise<T>;
}

export interface LocalDataOptions {
  /** Stellar network the app runs against. Defaults to the configured network. */
  stellarNetwork?: string;
  /** Decrypted bids, when the auction vault is unlocked, so they can be checked. */
  unlockedAuctionBids?: ReadonlyArray<{ name: string; submissionStatus?: string }>;
  now?: () => number;
}

// ─── Inventory model ───────────────────────────────────────────────────────────

export interface WalletScope {
  chain: string;
  network: string;
  wallet: string;
}

export type BlockerKind = 'signed' | 'ambiguous';

export interface TransactionBlocker {
  id: string;
  category: LocalDataCategoryId;
  kind: BlockerKind;
  summary: string;
  reference?: string;
}

export interface CategorySummary {
  id: LocalDataCategoryId;
  label: string;
  description: string;
  itemCount: number;
  exportMode: ExportMode;
  blockerCount: number;
}

interface ActivityRecord {
  id: string;
  chain: string;
  wallet: string;
  status?: string;
  [field: string]: unknown;
}

interface SubmissionRecordLike {
  operationId: string;
  draftKey?: string;
  status?: string;
  txHash?: string;
  signedEnvelope?: string;
  metadata?: Record<string, unknown>;
}

interface StorageItem {
  key: string;
  value: unknown;
}

interface VaultItem {
  key: string;
  direction: 'sent' | 'received';
  contractId?: string;
  deposits: unknown[];
}

interface CacheItem {
  cache: string;
  url: string;
}

export interface WalletItems {
  labels: StorageItem[];
  'scan-cursor': StorageItem[];
  activity: ActivityRecord[];
  'offline-intents': OfflineQueueEntry[];
  'pending-submissions': SubmissionRecordLike[];
  'vault-metadata': VaultItem[];
  'service-worker': Array<{ store: 'account' | 'sealed-key' | 'wrapping-key'; value: unknown }>;
  'cached-responses': CacheItem[];
}

export interface WalletInventory {
  key: string;
  scope: WalletScope;
  categories: CategorySummary[];
  blockers: TransactionBlocker[];
  totalItems: number;
  items: WalletItems;
}

type UnlinkedRecord =
  | { kind: 'activity'; value: ActivityRecord }
  | { kind: 'offline-entry'; value: OfflineQueueEntry }
  | { kind: 'submission'; value: SubmissionRecordLike }
  | { kind: 'unreadable'; key: string };

export interface DeviceItems {
  contacts: StorageItem[];
  'name-history': StorageItem[];
  'split-templates': StorageItem[];
  schedules: StorageItem[];
  notifications: Array<StorageItem | { key: string; dedupeIds: number }>;
  'auction-data': Array<{
    key: string;
    watchedAuctions: unknown[];
    encryptedBids: boolean;
    legacyBids: Array<{ name: string; submissionStatus?: string }>;
  }>;
  'key-vault': Array<{ store: string; key: string }>;
  'wallet-connection': StorageItem[];
  'push-subscriptions': Array<{ key: string }>;
  'unlinked-records': UnlinkedRecord[];
  preferences: StorageItem[];
  'other-app-data': Array<{ key: string }>;
}

export interface CacheSummary {
  name: string;
  entries: number;
}

export interface LocalDataInventory {
  generatedAt: number;
  stellarNetwork: string;
  wallets: WalletInventory[];
  device: CategorySummary[];
  deviceBlockers: TransactionBlocker[];
  deviceItems: DeviceItems;
  /** Caches holding network responses; a full reset deletes these. */
  dataCaches: CacheSummary[];
  /** App shell caches (code, fonts, images); kept so the app still loads offline. */
  shellCaches: string[];
}

export function scopeKey(scope: WalletScope): string {
  return `${scope.chain}|${scope.network}|${scope.wallet}`;
}

export function sameScope(a: WalletScope, b: WalletScope): boolean {
  return a.chain === b.chain && a.network === b.network && a.wallet === b.wallet;
}

// ─── Reading ───────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function storageKeys(storage: LocalStorageLike): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null) keys.push(key);
  }
  return keys;
}

/** Collection stored as a bare array, a `{ version, data }` envelope or legacy `{ templates }`. */
function collectionOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.data)) return value.data;
  if (isRecord(value) && Array.isArray(value.templates)) return value.templates;
  return [];
}

/** Collection inside a zustand `persist` record: `{ state: { [field]: [...] }, version }`. */
function persistedCollection(value: unknown, field: string): unknown[] {
  if (!isRecord(value) || !isRecord(value.state)) return [];
  const collection = value.state[field];
  return Array.isArray(collection) ? collection : [];
}

function labelWallet(key: string, value: unknown): string | null {
  if (!isRecord(value) || typeof value.stealthAddress !== 'string' || !value.stealthAddress) {
    return null;
  }
  if (typeof value.createdAt !== 'number') return null;
  const suffix = `:${value.stealthAddress}`;
  if (!key.endsWith(suffix)) return null;
  const wallet = key.slice(0, -suffix.length);
  return wallet && !wallet.startsWith('wraith') ? wallet : null;
}

function isActivityRecord(value: unknown): value is ActivityRecord {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.chain === 'string' &&
    typeof value.wallet === 'string'
  );
}

function readSubmissionState(
  raw: string | null,
): { operations: SubmissionRecordLike[]; readable: boolean } | null {
  if (raw === null) return null;
  const parsed = parseJson(raw);
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.operations)) {
    return { operations: [], readable: false };
  }
  const operations: SubmissionRecordLike[] = [];
  for (const [operationId, record] of Object.entries(parsed.operations)) {
    if (isRecord(record)) operations.push({ ...(record as object), operationId });
  }
  return { operations, readable: true };
}

function vaultNetworkNames(): Map<string, string> {
  const names = new Map<string, string>();
  for (const network of Object.values(STELLAR_NETWORKS)) {
    const digest = sha256(new TextEncoder().encode(network.networkPassphrase));
    const id = Array.from(digest.subarray(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
    names.set(id, network.name);
  }
  return names;
}

function isDataCache(name: string): boolean {
  return (
    name.startsWith(`${CACHE_PREFIX}-rpc-`) ||
    name.startsWith(`${CACHE_PREFIX}-runtime-`) ||
    name === 'rpc-cache'
  );
}

function emptyWalletItems(): WalletItems {
  return {
    labels: [],
    'scan-cursor': [],
    activity: [],
    'offline-intents': [],
    'pending-submissions': [],
    'vault-metadata': [],
    'service-worker': [],
    'cached-responses': [],
  };
}

function emptyDeviceItems(): DeviceItems {
  return {
    contacts: [],
    'name-history': [],
    'split-templates': [],
    schedules: [],
    notifications: [],
    'auction-data': [],
    'key-vault': [],
    'wallet-connection': [],
    'push-subscriptions': [],
    'unlinked-records': [],
    preferences: [],
    'other-app-data': [],
  };
}

function shortRef(value: string): string {
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

const ACTIVE_SIGNED_STATUSES = new Set(['queued', 'syncing', 'needs-review', 'conflict']);
const AMBIGUOUS_BID_STATUSES = new Set(['pending', 'unknown']);

function activityBlocker(entry: ActivityRecord, category: LocalDataCategoryId) {
  if (entry.status !== 'pending') return null;
  return {
    id: `activity:${entry.id}`,
    category,
    kind: 'ambiguous' as const,
    summary: `Transaction ${shortRef(entry.id)} is still pending; its outcome is unknown.`,
    reference: entry.id,
  };
}

function offlineBlocker(entry: OfflineQueueEntry, category: LocalDataCategoryId) {
  if (entry.kind !== 'signed-submit' || !ACTIVE_SIGNED_STATUSES.has(entry.status)) return null;
  const payload = entry.payload as SignedSubmitPayload;
  return {
    id: `offline:${entry.id}`,
    category,
    kind: 'signed' as const,
    summary: `Signed transaction ${shortRef(payload.txHash)} is queued (${entry.status}) and has not been broadcast.`,
    reference: payload.txHash,
  };
}

function submissionBlocker(record: SubmissionRecordLike, category: LocalDataCategoryId) {
  if (record.status !== 'submitting') return null;
  return {
    id: `submission:${record.operationId}`,
    category,
    kind: 'ambiguous' as const,
    summary: `Submission ${shortRef(record.txHash ?? record.operationId)} lost its network response; it may or may not have landed.`,
    reference: record.txHash,
  };
}

function walletBlockers(items: WalletItems): TransactionBlocker[] {
  const blockers: Array<TransactionBlocker | null> = [
    ...items.activity.map((entry) => activityBlocker(entry, 'activity')),
    ...items['offline-intents'].map((entry) => offlineBlocker(entry, 'offline-intents')),
    ...items['pending-submissions'].map((record) =>
      submissionBlocker(record, 'pending-submissions'),
    ),
  ];
  return blockers.filter((blocker): blocker is TransactionBlocker => blocker !== null);
}

function deviceBlockers(items: DeviceItems, options: LocalDataOptions): TransactionBlocker[] {
  const blockers: TransactionBlocker[] = [];
  for (const record of items['unlinked-records']) {
    const blocker =
      record.kind === 'activity'
        ? activityBlocker(record.value, 'unlinked-records')
        : record.kind === 'offline-entry'
          ? offlineBlocker(record.value, 'unlinked-records')
          : record.kind === 'submission'
            ? submissionBlocker(record.value, 'unlinked-records')
            : null;
    if (blocker) blockers.push(blocker);
  }
  for (const auction of items['auction-data']) {
    const bids = [...auction.legacyBids, ...(options.unlockedAuctionBids ?? [])];
    for (const bid of bids) {
      if (bid.submissionStatus && AMBIGUOUS_BID_STATUSES.has(bid.submissionStatus)) {
        blockers.push({
          id: `auction-bid:${bid.name}`,
          category: 'auction-data',
          kind: 'ambiguous',
          summary: `Bid for "${bid.name}" has an unconfirmed submission; its reveal material is still needed.`,
        });
      }
    }
    if (auction.encryptedBids && !options.unlockedAuctionBids) {
      blockers.push({
        id: 'auction-vault',
        category: 'auction-data',
        kind: 'ambiguous',
        summary:
          'The encrypted bid vault is locked, so unrevealed bids cannot be checked. Export an encrypted backup or unlock it first.',
      });
    }
  }
  return blockers.filter(
    (blocker, index) => blockers.findIndex((b) => b.id === blocker.id) === index,
  );
}

function summarise(
  ids: readonly LocalDataCategoryId[],
  counts: (id: LocalDataCategoryId) => number,
  blockers: TransactionBlocker[],
): CategorySummary[] {
  return ids.map((id) => {
    const definition = CATEGORY_DEFINITIONS[id];
    return {
      id,
      label: definition.label,
      description: definition.description,
      itemCount: counts(id),
      exportMode: definition.exportMode,
      blockerCount: blockers.filter((blocker) => blocker.category === id).length,
    };
  });
}

function deviceItemCount(items: DeviceItems, id: DeviceCategoryId): number {
  switch (id) {
    case 'contacts':
    case 'name-history':
    case 'split-templates':
    case 'schedules':
      return items[id].reduce((total, item) => total + collectionOf(item.value).length, 0);
    case 'notifications':
      return items.notifications.reduce(
        (total, item) =>
          total + ('dedupeIds' in item ? item.dedupeIds : collectionOf(item.value).length),
        0,
      );
    case 'auction-data':
      return items['auction-data'].reduce(
        (total, item) =>
          total +
          item.watchedAuctions.length +
          item.legacyBids.length +
          (item.encryptedBids ? 1 : 0),
        0,
      );
    default:
      return items[id].length;
  }
}

/** Reads every store once and attributes each record to a wallet scope or the device. */
export async function readLocalDataInventory(
  backends: LocalDataBackends,
  options: LocalDataOptions = {},
): Promise<LocalDataInventory> {
  const stellarNetwork = options.stellarNetwork ?? getStellarNetworkConfig().name;
  const { storage, idb, caches } = backends;
  const keys = storageKeys(storage);
  const claimed = new Set<string>();
  const scopes = new Map<string, { scope: WalletScope; items: WalletItems }>();
  const device = emptyDeviceItems();

  const bucket = (chain: string, wallet: string, network?: string): WalletItems => {
    const scope: WalletScope = {
      chain,
      wallet,
      network:
        network ?? (chain === 'stellar' ? stellarNetwork : (NON_STELLAR_NETWORKS[chain] ?? chain)),
    };
    const key = scopeKey(scope);
    let entry = scopes.get(key);
    if (!entry) {
      entry = { scope, items: emptyWalletItems() };
      scopes.set(key, entry);
    }
    return entry.items;
  };

  const read = (key: string): unknown => {
    claimed.add(key);
    return parseJson(storage.getItem(key));
  };

  const vaultNetworks = vaultNetworkNames();
  for (const key of keys) {
    if (key.startsWith(LOCAL_DATA_STORAGE_KEYS.scanCursorPrefix)) {
      const wallet = key.slice(LOCAL_DATA_STORAGE_KEYS.scanCursorPrefix.length);
      bucket('stellar', wallet)['scan-cursor'].push({ key, value: read(key) });
    } else if (key.startsWith(LOCAL_DATA_STORAGE_KEYS.vaultSentPrefix)) {
      const wallet = key.slice(LOCAL_DATA_STORAGE_KEYS.vaultSentPrefix.length);
      bucket('stellar', wallet)['vault-metadata'].push({
        key,
        direction: 'sent',
        deposits: collectionOf(read(key)),
      });
    } else if (key.startsWith(LOCAL_DATA_STORAGE_KEYS.vaultReceivedPrefix)) {
      const [networkId, contractId, wallet] = key
        .slice(LOCAL_DATA_STORAGE_KEYS.vaultReceivedPrefix.length)
        .split(':');
      if (!networkId || contractId === undefined || !wallet) continue;
      const network = vaultNetworks.get(networkId) ?? `unknown-${networkId}`;
      bucket('stellar', wallet, network)['vault-metadata'].push({
        key,
        direction: 'received',
        contractId,
        deposits: collectionOf(read(key)),
      });
    } else if (!key.startsWith('wraith')) {
      const value = parseJson(storage.getItem(key));
      const wallet = labelWallet(key, value);
      if (wallet) {
        claimed.add(key);
        bucket('stellar', wallet).labels.push({ key, value });
      }
    }
  }

  const activity = persistedCollection(read(LOCAL_DATA_STORAGE_KEYS.activity), 'entries').filter(
    isActivityRecord,
  );
  const activityWallet = new Map<string, ActivityRecord>();
  for (const entry of activity) {
    if (entry.wallet) {
      activityWallet.set(entry.id, entry);
      bucket(entry.chain, entry.wallet).activity.push(entry);
    } else {
      device['unlinked-records'].push({ kind: 'activity', value: entry });
    }
  }

  claimed.add(LOCAL_DATA_STORAGE_KEYS.offlineQueue);
  const offline = loadOfflineQueue(storage);
  const offlineByOperation = new Map<string, { chain: string; wallet: string }>();
  for (const entry of offline) {
    const payload = entry.payload as Partial<PaymentIntentPayload & SignedSubmitPayload>;
    const linked =
      payload.wallet && payload.chain
        ? { chain: payload.chain, wallet: payload.wallet }
        : payload.txHash
          ? activityWallet.get(payload.txHash)
          : undefined;
    if (linked) {
      bucket(linked.chain, linked.wallet)['offline-intents'].push(entry);
      if (payload.operationId) offlineByOperation.set(payload.operationId, linked);
    } else {
      device['unlinked-records'].push({ kind: 'offline-entry', value: entry });
    }
  }

  claimed.add(LOCAL_DATA_STORAGE_KEYS.submissions);
  const submissions = readSubmissionState(storage.getItem(LOCAL_DATA_STORAGE_KEYS.submissions));
  if (submissions && !submissions.readable) {
    device['unlinked-records'].push({
      kind: 'unreadable',
      key: LOCAL_DATA_STORAGE_KEYS.submissions,
    });
  }
  for (const record of submissions?.operations ?? []) {
    const taggedWallet =
      typeof record.metadata?.wallet === 'string' ? record.metadata.wallet : undefined;
    const linked = taggedWallet
      ? { chain: 'stellar', wallet: taggedWallet }
      : ((record.txHash ? activityWallet.get(record.txHash) : undefined) ??
        offlineByOperation.get(record.operationId));
    if (linked) bucket(linked.chain, linked.wallet)['pending-submissions'].push(record);
    else device['unlinked-records'].push({ kind: 'submission', value: record });
  }

  const deviceKey = (category: keyof DeviceItems, key: string) => {
    if (storage.getItem(key) === null) return;
    (device[category] as StorageItem[]).push({ key, value: read(key) });
  };
  deviceKey('contacts', LOCAL_DATA_STORAGE_KEYS.contacts);
  deviceKey('name-history', LOCAL_DATA_STORAGE_KEYS.nameHistory);
  deviceKey('split-templates', LOCAL_DATA_STORAGE_KEYS.splitTemplates);
  if (storage.getItem(LOCAL_DATA_STORAGE_KEYS.schedules) !== null) {
    device.schedules.push({
      key: LOCAL_DATA_STORAGE_KEYS.schedules,
      value: persistedCollection(read(LOCAL_DATA_STORAGE_KEYS.schedules), 'schedules'),
    });
  }
  if (storage.getItem(LOCAL_DATA_STORAGE_KEYS.notifications) !== null) {
    device.notifications.push({
      key: LOCAL_DATA_STORAGE_KEYS.notifications,
      value: persistedCollection(read(LOCAL_DATA_STORAGE_KEYS.notifications), 'notifications'),
    });
  }
  for (const key of [LOCAL_DATA_STORAGE_KEYS.auction, LOCAL_DATA_STORAGE_KEYS.auctionVault]) {
    if (storage.getItem(key) === null) continue;
    const value = read(key);
    const record = isRecord(value) ? value : {};
    const legacyState = isRecord(record.state)
      ? record.state
      : isRecord(record.data)
        ? record.data
        : undefined;
    const legacyBids = isRecord(legacyState?.bids)
      ? Object.values(legacyState.bids)
          .filter(isRecord)
          .map((bid) => ({
            name: String(bid.name ?? ''),
            submissionStatus:
              typeof bid.submissionStatus === 'string' ? bid.submissionStatus : undefined,
          }))
      : [];
    const watched = Array.isArray(record.watchedAuctions)
      ? record.watchedAuctions
      : Array.isArray(legacyState?.watchedAuctions)
        ? legacyState.watchedAuctions
        : [];
    device['auction-data'].push({
      key,
      watchedAuctions: watched,
      encryptedBids:
        isRecord(record.encryptedBids) ||
        isRecord(record.vault) ||
        (isRecord(record.kdf) && isRecord(record.cipher)),
      legacyBids,
    });
  }
  for (const key of WALLET_CONNECTION_KEYS) deviceKey('wallet-connection', key);
  for (const key of PREFERENCE_KEYS) deviceKey('preferences', key);
  for (const key of keys) {
    if (key.startsWith('wraith') && !claimed.has(key)) device['other-app-data'].push({ key });
  }

  const db = LOCAL_DATA_DATABASES;
  for (const entry of await idb.entries(db.worker.name, db.worker.accounts)) {
    if (STELLAR_ADDRESS.test(entry.key)) {
      bucket('stellar', entry.key)['service-worker'].push({ store: 'account', value: entry.value });
    } else {
      device['push-subscriptions'].push({ key: entry.key });
    }
  }
  const dedupeIds = (await idb.entries(db.worker.name, db.worker.notificationIds)).length;
  if (dedupeIds > 0) {
    device.notifications.push({ key: `${db.worker.name}/${db.worker.notificationIds}`, dedupeIds });
  }
  for (const entry of await idb.entries(db.scanKeys.name, db.scanKeys.sealed)) {
    bucket('stellar', entry.key)['service-worker'].push({ store: 'sealed-key', value: null });
  }
  for (const entry of await idb.entries(db.scanKeys.name, db.scanKeys.wrapping)) {
    bucket('stellar', entry.key)['service-worker'].push({ store: 'wrapping-key', value: null });
  }
  for (const store of [db.keyVault.entries, db.keyVault.metadata]) {
    for (const entry of await idb.entries(db.keyVault.name, store)) {
      device['key-vault'].push({ store, key: entry.key });
    }
  }

  const dataCaches: CacheSummary[] = [];
  const shellCaches: string[] = [];
  const cachedUrls: CacheItem[] = [];
  for (const name of await caches.names()) {
    if (!isDataCache(name)) {
      if (name.startsWith(`${CACHE_PREFIX}-`)) shellCaches.push(name);
      continue;
    }
    const urls = await caches.urls(name);
    dataCaches.push({ name, entries: urls.length });
    for (const url of urls) cachedUrls.push({ cache: name, url });
  }
  for (const { scope, items } of scopes.values()) {
    const tokens = cacheMatchTokens(items, scope);
    const hosts = networkHosts(scope);
    items['cached-responses'] = cachedUrls.filter(
      (entry) => urlOnHosts(entry.url, hosts) && urlMentions(entry.url, tokens),
    );
  }

  const deviceBlockerList = deviceBlockers(device, options);
  const wallets = [...scopes.entries()]
    .map(([key, { scope, items }]) => {
      const blockers = walletBlockers(items);
      const categories = summarise(
        WALLET_CATEGORY_IDS,
        (id) => items[id as WalletCategoryId].length,
        blockers,
      );
      return {
        key,
        scope,
        items,
        blockers,
        categories,
        totalItems: categories.reduce((total, category) => total + category.itemCount, 0),
      };
    })
    .filter((wallet) => wallet.totalItems > 0)
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    generatedAt: (options.now ?? Date.now)(),
    stellarNetwork,
    wallets,
    device: summarise(
      DEVICE_CATEGORY_IDS,
      (id) => deviceItemCount(device, id as DeviceCategoryId),
      deviceBlockerList,
    ),
    deviceBlockers: deviceBlockerList,
    deviceItems: device,
    dataCaches,
    shellCaches,
  };
}

function cacheMatchTokens(items: WalletItems, scope: WalletScope): string[] {
  const tokens = new Set<string>([scope.wallet]);
  for (const label of items.labels) {
    if (isRecord(label.value) && typeof label.value.stealthAddress === 'string') {
      tokens.add(label.value.stealthAddress);
    }
  }
  for (const vault of items['vault-metadata']) {
    for (const deposit of vault.deposits) {
      if (isRecord(deposit) && typeof deposit.recipient === 'string') tokens.add(deposit.recipient);
    }
  }
  for (const entry of items.activity) tokens.add(entry.id);
  return [...tokens].filter((token) => token.length >= MIN_CACHE_MATCH_TOKEN);
}

/**
 * Hosts serving the scope's network, so the same wallet on another Stellar
 * network keeps its own cache entries. Null when the chain has a single network.
 */
function networkHosts(scope: WalletScope): string[] | null {
  if (scope.chain !== 'stellar') return null;
  const network = Object.values(STELLAR_NETWORKS).find(
    (candidate) => candidate.name === scope.network,
  );
  if (!network) return [];
  return [network.horizonUrl, network.rpcUrl].map((url) => new URL(url).hostname);
}

function urlOnHosts(url: string, hosts: string[] | null): boolean {
  if (hosts === null) return true;
  try {
    return hosts.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

function urlMentions(url: string, tokens: string[]): boolean {
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    // Keep the raw URL when it holds a malformed escape.
  }
  return tokens.some((token) => decoded.includes(token));
}

export function findWallet(
  inventory: LocalDataInventory,
  scope: WalletScope,
): WalletInventory | undefined {
  return inventory.wallets.find((wallet) => sameScope(wallet.scope, scope));
}

// ─── Export ────────────────────────────────────────────────────────────────────

export interface LocalDataExportCategory {
  id: LocalDataCategoryId;
  label: string;
  included: boolean;
  itemCount: number;
  redactedFields: string[];
}

export interface LocalDataExport {
  type: typeof LOCAL_DATA_EXPORT_TYPE;
  schemaVersion: typeof LOCAL_DATA_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  scope: ({ kind: 'wallet' } & WalletScope) | { kind: 'device' };
  categories: LocalDataExportCategory[];
  withheld: WithheldDisclosure[];
  data: Partial<Record<LocalDataCategoryId, unknown>>;
}

function omit<T extends object>(value: T, path: string): T {
  const [head, ...rest] = path.split('.');
  if (!isRecord(value) || !(head in value)) return value;
  const copy = { ...(value as Record<string, unknown>) };
  if (rest.length === 0) delete copy[head];
  else copy[head] = omit(copy[head] as object, rest.join('.'));
  return copy as T;
}

function redact<T extends object>(value: T, fields: string[]): T {
  return fields.reduce((current, field) => omit(current, field), value);
}

function walletCategoryData(items: WalletItems, id: WalletCategoryId): unknown {
  const fields = CATEGORY_DEFINITIONS[id].redactedFields;
  switch (id) {
    case 'labels':
      return items.labels.map((item) => item.value);
    case 'scan-cursor':
      return items['scan-cursor'].map((item) => ({ ledger: item.value }));
    case 'activity':
      return items.activity;
    case 'offline-intents':
      return items['offline-intents'].map((entry) => redact(entry, fields));
    case 'pending-submissions':
      return items['pending-submissions'].map((record) => redact(record, fields));
    case 'vault-metadata':
      return items['vault-metadata'].map(({ direction, contractId, deposits }) => ({
        direction,
        ...(contractId !== undefined ? { contractId } : {}),
        deposits,
      }));
    case 'service-worker':
      return items['service-worker']
        .filter((item) => item.store === 'account' && isRecord(item.value))
        .map((item) => {
          const record = item.value as Record<string, unknown>;
          return {
            publicKey: record.publicKey,
            ...(typeof record.lastScannedLedger === 'number'
              ? { lastScannedLedger: record.lastScannedLedger }
              : {}),
            ...(typeof record.timestamp === 'number' ? { timestamp: record.timestamp } : {}),
          };
        });
    case 'cached-responses':
      return items['cached-responses'].map(({ cache, url }) => ({ cache, url }));
  }
}

function deviceCategoryData(items: DeviceItems, id: DeviceCategoryId): unknown {
  const fields = CATEGORY_DEFINITIONS[id].redactedFields;
  switch (id) {
    case 'contacts':
    case 'name-history':
    case 'split-templates':
    case 'schedules':
      return items[id].flatMap((item) => collectionOf(item.value));
    case 'notifications':
      return items.notifications.flatMap((item) =>
        'dedupeIds' in item ? [] : collectionOf(item.value),
      );
    case 'auction-data':
      return items['auction-data'].flatMap((item) => item.watchedAuctions);
    case 'wallet-connection':
    case 'preferences':
      return Object.fromEntries(items[id].map((item) => [item.key, item.value]));
    case 'unlinked-records':
      return items['unlinked-records'].map((record) =>
        record.kind === 'unreadable'
          ? { kind: record.kind, key: record.key }
          : { kind: record.kind, value: redact(record.value, fields) },
      );
    case 'other-app-data':
      return items['other-app-data'].map((item) => item.key);
    case 'key-vault':
    case 'push-subscriptions':
      return undefined;
  }
}

function exportDocument(
  scope: LocalDataExport['scope'],
  summaries: CategorySummary[],
  selected: ReadonlySet<LocalDataCategoryId>,
  dataFor: (id: LocalDataCategoryId) => unknown,
  now: number,
): LocalDataExport {
  const categories: LocalDataExportCategory[] = [];
  const withheld: WithheldDisclosure[] = [];
  const data: LocalDataExport['data'] = {};
  for (const summary of summaries) {
    const definition = CATEGORY_DEFINITIONS[summary.id];
    const included = selected.has(summary.id) && definition.exportMode !== 'withheld';
    categories.push({
      id: summary.id,
      label: definition.label,
      included,
      itemCount: summary.itemCount,
      redactedFields: definition.redactedFields,
    });
    if (selected.has(summary.id) && definition.withheld) {
      withheld.push({ id: summary.id, ...definition.withheld });
    }
    if (included) data[summary.id] = dataFor(summary.id);
  }
  return {
    type: LOCAL_DATA_EXPORT_TYPE,
    schemaVersion: LOCAL_DATA_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date(now).toISOString(),
    scope,
    categories,
    withheld,
    data,
  };
}

/** Builds an ordinary export of one wallet scope. Secrets and ciphertext are never included. */
export function buildWalletExport(
  wallet: WalletInventory,
  categories: readonly WalletCategoryId[],
  now: number = Date.now(),
): LocalDataExport {
  return exportDocument(
    { kind: 'wallet', ...wallet.scope },
    wallet.categories,
    new Set(categories),
    (id) => walletCategoryData(wallet.items, id as WalletCategoryId),
    now,
  );
}

/** Builds an ordinary export of device-wide data. Secrets and ciphertext are never included. */
export function buildDeviceExport(
  inventory: LocalDataInventory,
  categories: readonly DeviceCategoryId[],
  now: number = Date.now(),
): LocalDataExport {
  return exportDocument(
    { kind: 'device' },
    inventory.device,
    new Set(categories),
    (id) => deviceCategoryData(inventory.deviceItems, id as DeviceCategoryId),
    now,
  );
}

export function localDataExportFilename(document: LocalDataExport): string {
  const date = document.exportedAt.slice(0, 10);
  if (document.scope.kind === 'device') return `wraith-local-data-device-${date}.json`;
  const wallet = document.scope.wallet.slice(0, 8).replace(/[^A-Za-z0-9]/g, '');
  return `wraith-local-data-${document.scope.chain}-${document.scope.network}-${wallet}-${date}.json`;
}

// ─── Deletion ──────────────────────────────────────────────────────────────────

export class LocalDataBlockedError extends Error {
  readonly blockers: TransactionBlocker[];

  constructor(blockers: TransactionBlocker[]) {
    super(
      `${blockers.length} signed or unconfirmed transaction record(s) must be resolved before deletion.`,
    );
    this.name = 'LocalDataBlockedError';
    this.blockers = blockers;
  }
}

export interface DeletionReport {
  removed: Partial<Record<LocalDataCategoryId | 'caches', number>>;
  /** Whether the service worker acknowledged, or the page removed its records directly. */
  worker: 'acknowledged' | 'direct' | 'not-needed';
  residual: Partial<Record<LocalDataCategoryId, number>>;
  verified: boolean;
}

/** Blockers that stop a deletion of `categories`, minus the ones explicitly resolved. */
export function unresolvedBlockers(
  blockers: readonly TransactionBlocker[],
  categories: readonly LocalDataCategoryId[],
  resolvedIds: readonly string[] = [],
): TransactionBlocker[] {
  const selected = new Set(categories);
  const resolved = new Set(resolvedIds);
  return blockers.filter((blocker) => selected.has(blocker.category) && !resolved.has(blocker.id));
}

async function lockedRewrite(
  backends: LocalDataBackends,
  lockName: string,
  work: () => void,
): Promise<void> {
  if (backends.withLock) {
    await backends.withLock(lockName, async () => work());
  } else {
    work();
  }
}

function rewritePersistedCollection(
  storage: LocalStorageLike,
  key: string,
  field: string,
  keep: (value: unknown) => boolean,
): number {
  const parsed = parseJson(storage.getItem(key));
  if (!isRecord(parsed) || !isRecord(parsed.state) || !Array.isArray(parsed.state[field])) {
    return 0;
  }
  const current = parsed.state[field] as unknown[];
  const next = current.filter(keep);
  if (next.length !== current.length) {
    storage.setItem(key, JSON.stringify({ ...parsed, state: { ...parsed.state, [field]: next } }));
  }
  return current.length - next.length;
}

function rewriteSubmissions(storage: LocalStorageLike, operationIds: Set<string>): number {
  const parsed = parseJson(storage.getItem(LOCAL_DATA_STORAGE_KEYS.submissions));
  if (!isRecord(parsed) || !isRecord(parsed.operations)) return 0;
  const operations = { ...parsed.operations };
  let removed = 0;
  for (const id of operationIds) {
    if (Object.prototype.hasOwnProperty.call(operations, id)) {
      delete operations[id];
      removed += 1;
    }
  }
  const drafts = isRecord(parsed.drafts)
    ? Object.fromEntries(
        Object.entries(parsed.drafts).filter(
          ([, operationId]) => typeof operationId === 'string' && !operationIds.has(operationId),
        ),
      )
    : {};
  if (removed > 0) {
    storage.setItem(
      LOCAL_DATA_STORAGE_KEYS.submissions,
      JSON.stringify({ ...parsed, operations, drafts }),
    );
  }
  return removed;
}

async function deleteWalletCategory(
  backends: LocalDataBackends,
  wallet: WalletInventory,
  id: WalletCategoryId,
): Promise<{ removed: number; worker?: 'acknowledged' | 'direct' }> {
  const { storage, idb, caches } = backends;
  const { items, scope } = wallet;
  switch (id) {
    case 'labels':
    case 'scan-cursor':
    case 'vault-metadata':
      for (const item of items[id]) storage.removeItem(item.key);
      return { removed: items[id].length };
    case 'activity': {
      const ids = new Set(items.activity.map((entry) => entry.id));
      const removed = rewritePersistedCollection(
        storage,
        LOCAL_DATA_STORAGE_KEYS.activity,
        'entries',
        (entry) =>
          !(
            isActivityRecord(entry) &&
            ids.has(entry.id) &&
            entry.wallet === scope.wallet &&
            entry.chain === scope.chain
          ),
      );
      return { removed };
    }
    case 'offline-intents': {
      const ids = new Set(items['offline-intents'].map((entry) => entry.id));
      const entries = loadOfflineQueue(storage);
      const next = entries.filter((entry) => !ids.has(entry.id));
      if (next.length !== entries.length) saveOfflineQueue(storage, next);
      return { removed: entries.length - next.length };
    }
    case 'pending-submissions': {
      const ids = new Set(items['pending-submissions'].map((record) => record.operationId));
      let removed = 0;
      // Same lock name submissionIdempotency.ts takes around its own read-modify-write.
      await lockedRewrite(backends, 'wraith-submission:state', () => {
        removed = rewriteSubmissions(storage, ids);
      });
      return { removed };
    }
    case 'service-worker': {
      const db = LOCAL_DATA_DATABASES;
      const hasAccount = items['service-worker'].some((item) => item.store === 'account');
      let worker: 'acknowledged' | 'direct' | undefined;
      if (hasAccount) {
        // The worker owns this database; the page only writes it when no worker answers.
        const acknowledged = await backends.worker.clear({
          scope: 'wallet',
          publicKey: scope.wallet,
        });
        worker = acknowledged ? 'acknowledged' : 'direct';
        if (!acknowledged) await idb.delete(db.worker.name, db.worker.accounts, [scope.wallet]);
      }
      // The page and the worker share the scan-key database; the page clears it, as
      // useStellarNotifications already does when it unregisters a key.
      await idb.delete(db.scanKeys.name, db.scanKeys.sealed, [scope.wallet]);
      await idb.delete(db.scanKeys.name, db.scanKeys.wrapping, [scope.wallet]);
      return { removed: items['service-worker'].length, worker };
    }
    case 'cached-responses': {
      const byCache = new Map<string, string[]>();
      for (const entry of items['cached-responses']) {
        byCache.set(entry.cache, [...(byCache.get(entry.cache) ?? []), entry.url]);
      }
      for (const [cache, urls] of byCache) await caches.deleteUrls(cache, urls);
      return { removed: items['cached-responses'].length };
    }
  }
}

/**
 * Deletes the selected categories for exactly one wallet/network scope.
 * Refuses (LocalDataBlockedError) while any signed or ambiguous transaction in
 * those categories has not been explicitly resolved.
 */
export async function deleteWalletData(
  backends: LocalDataBackends,
  request: {
    scope: WalletScope;
    categories: readonly WalletCategoryId[];
    resolvedBlockerIds?: readonly string[];
  },
  options: LocalDataOptions = {},
): Promise<DeletionReport> {
  const before = await readLocalDataInventory(backends, options);
  const wallet = findWallet(before, request.scope);
  const report: DeletionReport = {
    removed: {},
    worker: 'not-needed',
    residual: {},
    verified: true,
  };
  if (!wallet) return report;

  const blocked = unresolvedBlockers(
    wallet.blockers,
    request.categories,
    request.resolvedBlockerIds,
  );
  if (blocked.length > 0) throw new LocalDataBlockedError(blocked);

  // Cache entries are matched with tokens taken from the other categories, so
  // they go first, while the labels and activity that name them still exist.
  const ordered = [...request.categories].sort(
    (a, b) => Number(b === 'cached-responses') - Number(a === 'cached-responses'),
  );
  for (const id of ordered) {
    const result = await deleteWalletCategory(backends, wallet, id);
    report.removed[id] = result.removed;
    if (result.worker) report.worker = result.worker;
  }

  const after = findWallet(await readLocalDataInventory(backends, options), request.scope);
  for (const id of request.categories) {
    report.residual[id] = after ? after.items[id].length : 0;
  }
  report.verified = Object.values(report.residual).every((count) => count === 0);
  return report;
}

export interface ResetSummary {
  wallets: Array<{
    scope: WalletScope;
    categories: Array<{ id: LocalDataCategoryId; label: string; itemCount: number }>;
  }>;
  device: Array<{ id: LocalDataCategoryId; label: string; itemCount: number }>;
  caches: CacheSummary[];
  kept: string[];
  blockers: TransactionBlocker[];
  totalItems: number;
}

/** Everything a full local reset would remove, and what it deliberately keeps. */
export function buildResetSummary(inventory: LocalDataInventory): ResetSummary {
  const nonEmpty = (categories: CategorySummary[]) =>
    categories
      .filter((category) => category.itemCount > 0)
      .map(({ id, label, itemCount }) => ({ id, label, itemCount }));
  const wallets = inventory.wallets.map((wallet) => ({
    scope: wallet.scope,
    categories: nonEmpty(wallet.categories),
  }));
  const device = nonEmpty(inventory.device);
  const caches = inventory.dataCaches.filter((cache) => cache.entries > 0);
  const totalItems =
    wallets.reduce(
      (total, wallet) => total + wallet.categories.reduce((sum, c) => sum + c.itemCount, 0),
      0,
    ) +
    device.reduce((total, category) => total + category.itemCount, 0) +
    caches.reduce((total, cache) => total + cache.entries, 0);
  return {
    wallets,
    device,
    caches,
    kept: [
      ...inventory.shellCaches.map(
        (name) => `${name}: app code, fonts and images only (keeps the app working offline)`,
      ),
      'State kept by wallet extensions, WalletConnect or RainbowKit (disconnect in your wallet to clear it)',
      'Anything on-chain: balances, announcements and transaction history',
    ],
    blockers: [
      ...inventory.wallets.flatMap((wallet) => wallet.blockers),
      ...inventory.deviceBlockers,
    ],
    totalItems,
  };
}

/**
 * Removes every record this app keeps on the device. Requires the typed
 * confirmation and the same explicit resolution of signed or ambiguous
 * transactions as a wallet-scoped deletion.
 */
export async function resetAllLocalData(
  backends: LocalDataBackends,
  request: { confirmation: string; resolvedBlockerIds?: readonly string[] },
  options: LocalDataOptions = {},
): Promise<DeletionReport> {
  if (request.confirmation !== FULL_RESET_CONFIRMATION) {
    throw new Error(`Type ${FULL_RESET_CONFIRMATION} to confirm a full local reset.`);
  }
  const before = await readLocalDataInventory(backends, options);
  const summary = buildResetSummary(before);
  const resolved = new Set(request.resolvedBlockerIds ?? []);
  const blocked = summary.blockers.filter((blocker) => !resolved.has(blocker.id));
  if (blocked.length > 0) throw new LocalDataBlockedError(blocked);

  const { storage, idb, caches, worker } = backends;
  const report: DeletionReport = { removed: {}, worker: 'direct', residual: {}, verified: true };

  const doomed = new Set<string>();
  for (const wallet of before.wallets) {
    for (const item of [
      ...wallet.items.labels,
      ...wallet.items['scan-cursor'],
      ...wallet.items['vault-metadata'],
    ]) {
      doomed.add(item.key);
    }
  }
  for (const key of storageKeys(storage)) if (key.startsWith('wraith')) doomed.add(key);
  for (const key of doomed) storage.removeItem(key);
  for (const wallet of summary.wallets) {
    for (const category of wallet.categories) {
      report.removed[category.id] = (report.removed[category.id] ?? 0) + category.itemCount;
    }
  }
  for (const category of summary.device) report.removed[category.id] = category.itemCount;

  const db = LOCAL_DATA_DATABASES;
  const acknowledged = await worker.clear({ scope: 'all' });
  report.worker = acknowledged ? 'acknowledged' : 'direct';
  if (!acknowledged) {
    await idb.clear(db.worker.name, db.worker.accounts);
    await idb.clear(db.worker.name, db.worker.notificationIds);
  }
  await idb.clear(db.scanKeys.name, db.scanKeys.sealed);
  await idb.clear(db.scanKeys.name, db.scanKeys.wrapping);
  await idb.clear(db.keyVault.name, db.keyVault.entries);
  await idb.clear(db.keyVault.name, db.keyVault.metadata);
  await worker.unsubscribePush();

  let cacheEntries = 0;
  for (const cache of before.dataCaches) {
    await caches.deleteCache(cache.name);
    cacheEntries += cache.entries;
  }
  report.removed.caches = cacheEntries;

  const after = await readLocalDataInventory(backends, options);
  for (const wallet of after.wallets) {
    for (const category of wallet.categories) {
      report.residual[category.id] = (report.residual[category.id] ?? 0) + category.itemCount;
    }
  }
  for (const category of after.device) {
    if (category.itemCount > 0) report.residual[category.id] = category.itemCount;
  }
  report.verified =
    after.wallets.length === 0 &&
    after.device.every((category) => category.itemCount === 0) &&
    after.dataCaches.length === 0;
  return report;
}
