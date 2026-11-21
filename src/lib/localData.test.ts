import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { STELLAR_NETWORKS } from '@/lib/stellar/deployments';
import { recipientVaultStorageKey } from '@/lib/stellar/vaultClaim';
import { createOfflineEntry, OFFLINE_QUEUE_STORAGE_KEY } from './offlineQueue';
import { CURRENT_STORAGE_VERSION } from './versionedStorage';
import {
  FULL_RESET_CONFIRMATION,
  LOCAL_DATA_DATABASES,
  LOCAL_DATA_STORAGE_KEYS,
  LocalDataBlockedError,
  WALLET_CATEGORY_IDS,
  DEVICE_CATEGORY_IDS,
  buildDeviceExport,
  buildResetSummary,
  buildWalletExport,
  deleteWalletData,
  findWallet,
  readLocalDataInventory,
  resetAllLocalData,
  type IdbEntry,
  type LocalDataBackends,
  type WalletScope,
  type WorkerClearRequest,
} from './localData';

const WALLET_A = `G${'A'.repeat(55)}`;
const WALLET_B = `G${'B'.repeat(55)}`;
const STEALTH_A = `G${'C'.repeat(55)}`;
const STEALTH_B = `G${'D'.repeat(55)}`;
const TX_A = 'a'.repeat(64);
const TX_B = 'b'.repeat(64);
const VAULT_CONTRACT = `C${'E'.repeat(55)}`;
const OPTIONS = { stellarNetwork: 'testnet', now: () => Date.UTC(2026, 10, 21) };
const SCOPE_A: WalletScope = { chain: 'stellar', network: 'testnet', wallet: WALLET_A };
const SCOPE_B: WalletScope = { chain: 'stellar', network: 'testnet', wallet: WALLET_B };
const SECRET_MARKERS = [
  'SIGNED-ENVELOPE-SECRET',
  'SUBMISSION-ENVELOPE-SECRET',
  'P256DH-SECRET',
  'AUTH-SECRET',
  'BID-SALT-SECRET',
  'VAULT-CIPHERTEXT-SECRET',
  'SEALED-KEY-SECRET',
];

class MemoryStorage {
  readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

class MemoryIdb {
  readonly databases = new Map<string, Map<string, Map<string, unknown>>>();

  store(database: string, store: string) {
    let db = this.databases.get(database);
    if (!db) {
      db = new Map();
      this.databases.set(database, db);
    }
    let records = db.get(store);
    if (!records) {
      records = new Map();
      db.set(store, records);
    }
    return records;
  }

  async entries(database: string, store: string): Promise<IdbEntry[]> {
    const records = this.databases.get(database)?.get(store);
    return records ? [...records].map(([key, value]) => ({ key, value })) : [];
  }

  async delete(database: string, store: string, keys: string[]) {
    for (const key of keys) this.databases.get(database)?.get(store)?.delete(key);
  }

  async clear(database: string, store: string) {
    this.databases.get(database)?.get(store)?.clear();
  }
}

class MemoryCaches {
  readonly caches = new Map<string, string[]>();
  async names() {
    return [...this.caches.keys()];
  }
  async urls(name: string) {
    return [...(this.caches.get(name) ?? [])];
  }
  async deleteUrls(name: string, urls: string[]) {
    const cache = this.caches.get(name);
    if (cache)
      this.caches.set(
        name,
        cache.filter((url) => !urls.includes(url)),
      );
  }
  async deleteCache(name: string) {
    this.caches.delete(name);
  }
}

/** Stands in for app-sw.ts: clears the records the worker owns when it is active. */
class FakeWorker {
  active = true;
  pushSubscribed = true;
  readonly requests: WorkerClearRequest[] = [];
  constructor(private readonly idb: MemoryIdb) {}

  async clear(request: WorkerClearRequest) {
    this.requests.push(request);
    if (!this.active) return false;
    const { name, accounts, notificationIds } = LOCAL_DATA_DATABASES.worker;
    if (request.scope === 'wallet') {
      await this.idb.delete(name, accounts, [request.publicKey]);
    } else {
      await this.idb.clear(name, accounts);
      await this.idb.clear(name, notificationIds);
    }
    return true;
  }

  async unsubscribePush() {
    const was = this.pushSubscribed;
    this.pushSubscribed = false;
    return was;
  }
}

function backends() {
  const storage = new MemoryStorage();
  const idb = new MemoryIdb();
  const caches = new MemoryCaches();
  const worker = new FakeWorker(idb);
  const value: LocalDataBackends = { storage, idb, caches, worker };
  return { storage, idb, caches, worker, value };
}

function vaultKey(wallet: string, network: keyof typeof STELLAR_NETWORKS) {
  return recipientVaultStorageKey(
    wallet,
    VAULT_CONTRACT,
    STELLAR_NETWORKS[network].networkPassphrase,
  );
}

function activityEntry(id: string, wallet: string, status = 'confirmed') {
  return {
    id,
    chain: 'stellar',
    wallet,
    kind: 'stealth-send',
    direction: 'out',
    status,
    amount: '5',
    timestamp: 1,
  };
}

/** Seeds every wallet-scoped store for `wallet`, plus device-wide data. */
function seedWallet(env: ReturnType<typeof backends>, wallet: string, stealth: string, tx: string) {
  const { storage, idb, caches } = env;
  storage.setItem(
    `${wallet}:${stealth}`,
    JSON.stringify({ stealthAddress: stealth, label: 'rent', tags: ['home'], createdAt: 1 }),
  );
  storage.setItem(`${LOCAL_DATA_STORAGE_KEYS.scanCursorPrefix}${wallet}`, '1234');
  storage.setItem(
    `${LOCAL_DATA_STORAGE_KEYS.vaultSentPrefix}${wallet}`,
    JSON.stringify([{ depositId: tx, sender: wallet, recipient: stealth, amount: '1' }]),
  );
  storage.setItem(
    vaultKey(wallet, 'testnet'),
    JSON.stringify({ version: CURRENT_STORAGE_VERSION, data: [{ depositId: tx }] }),
  );

  const activity = JSON.parse(storage.getItem(LOCAL_DATA_STORAGE_KEYS.activity) ?? 'null') ?? {
    state: { entries: [] },
    version: 0,
  };
  activity.state.entries.push(activityEntry(tx, wallet));
  storage.setItem(LOCAL_DATA_STORAGE_KEYS.activity, JSON.stringify(activity));

  const queue = JSON.parse(storage.getItem(OFFLINE_QUEUE_STORAGE_KEY) ?? 'null') ?? {
    version: CURRENT_STORAGE_VERSION,
    data: [],
  };
  queue.data.push(
    createOfflineEntry('payment-intent', {
      operationId: `intent-${wallet.slice(1, 5)}`,
      chain: 'stellar',
      wallet,
      recipient: 'st:xlm:abc',
      amount: '1',
      source: 'form',
    }),
    // Legacy entry with no wallet tag: attributed through the activity record for its hash.
    {
      ...createOfflineEntry('signed-submit', {
        chain: 'stellar',
        txHash: tx,
        signedXdr: 'SIGNED-ENVELOPE-SECRET',
      }),
      status: 'done',
    },
  );
  storage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(queue));

  const submissions = JSON.parse(
    storage.getItem(LOCAL_DATA_STORAGE_KEYS.submissions) ?? 'null',
  ) ?? { version: 1, operations: {}, drafts: {} };
  const operationId = `op-${wallet.slice(1, 5)}`;
  submissions.operations[operationId] = {
    operationId,
    draftKey: tx,
    status: 'submitted',
    txHash: tx,
    signedEnvelope: 'SUBMISSION-ENVELOPE-SECRET',
    metadata: { wallet },
  };
  submissions.drafts[tx] = operationId;
  storage.setItem(LOCAL_DATA_STORAGE_KEYS.submissions, JSON.stringify(submissions));

  const { worker, scanKeys } = LOCAL_DATA_DATABASES;
  idb
    .store(worker.name, worker.accounts)
    .set(wallet, { publicKey: wallet, lastScannedLedger: 99, timestamp: 1 });
  idb.store(scanKeys.name, scanKeys.sealed).set(wallet, { ciphertext: 'SEALED-KEY-SECRET' });
  idb.store(scanKeys.name, scanKeys.wrapping).set(wallet, { type: 'secret' });

  const rpc = caches.caches.get('wraith-rpc-v2') ?? [];
  rpc.push(
    `https://horizon-testnet.stellar.org/accounts/${wallet}`,
    `https://horizon-testnet.stellar.org/accounts/${stealth}/payments`,
    `https://horizon-testnet.stellar.org/transactions/${tx}`,
  );
  caches.caches.set('wraith-rpc-v2', rpc);
}

function seedDevice(env: ReturnType<typeof backends>) {
  const { storage, idb, caches } = env;
  storage.setItem(
    LOCAL_DATA_STORAGE_KEYS.contacts,
    JSON.stringify({ version: 1, data: [{ address: 'st:xlm:friend', name: 'Ada', addedAt: 1 }] }),
  );
  storage.setItem(
    LOCAL_DATA_STORAGE_KEYS.notifications,
    JSON.stringify({ state: { notifications: [{ id: 'n1', title: 'Paid' }] }, version: 0 }),
  );
  storage.setItem(
    LOCAL_DATA_STORAGE_KEYS.auction,
    JSON.stringify({
      version: 0,
      state: {
        watchedAuctions: [{ name: 'ada', endsAt: 5 }],
        bids: { ada: { name: 'ada', saltHex: 'BID-SALT-SECRET', submissionStatus: 'committed' } },
      },
    }),
  );
  storage.setItem('wraith-theme', 'dark');
  storage.setItem('wraith:stellar:pubkey', WALLET_A);
  storage.setItem('wagmi.store', '{"connections":[]}');
  storage.setItem('unrelated-app', 'keep');

  const { worker, keyVault } = LOCAL_DATA_DATABASES;
  idb.store(worker.name, worker.accounts).set('BP256DH-KEY', {
    publicKey: 'BP256DH-KEY',
    pushSubscription: {
      endpoint: 'https://push',
      keys: { p256dh: 'P256DH-SECRET', auth: 'AUTH-SECRET' },
    },
  });
  idb.store(worker.name, worker.notificationIds).set('n1', { id: 'n1', timestamp: 1 });
  idb
    .store(keyVault.name, keyVault.entries)
    .set('stellar', { ciphertext: 'VAULT-CIPHERTEXT-SECRET' });
  idb.store(keyVault.name, keyVault.metadata).set('vault-meta', { salt: 'x' });

  caches.caches.set('wraith-precache-v2', ['https://app/index.html']);
  caches.caches.set('wraith-assets-v2', ['https://app/assets/chunk.js']);
}

function seeded() {
  const env = backends();
  seedWallet(env, WALLET_A, STEALTH_A, TX_A);
  seedWallet(env, WALLET_B, STEALTH_B, TX_B);
  seedDevice(env);
  // Same wallet, different network: must survive a testnet-scoped deletion.
  env.storage.setItem(
    vaultKey(WALLET_A, 'futurenet'),
    JSON.stringify({ version: CURRENT_STORAGE_VERSION, data: [{ depositId: 'f'.repeat(64) }] }),
  );
  env.caches.caches
    .get('wraith-rpc-v2')!
    .push(`https://horizon-futurenet.stellar.org/accounts/${WALLET_A}`);
  return env;
}

describe('local data inventory', () => {
  it('attributes every store to its wallet/network scope or to the device', async () => {
    const env = seeded();
    const inventory = await readLocalDataInventory(env.value, OPTIONS);

    expect(inventory.wallets.map((wallet) => wallet.key)).toEqual([
      `stellar|futurenet|${WALLET_A}`,
      `stellar|testnet|${WALLET_A}`,
      `stellar|testnet|${WALLET_B}`,
    ]);

    const a = findWallet(inventory, SCOPE_A)!;
    const counts = Object.fromEntries(a.categories.map((c) => [c.id, c.itemCount]));
    expect(counts).toEqual({
      labels: 1,
      'scan-cursor': 1,
      activity: 1,
      'offline-intents': 2,
      'pending-submissions': 1,
      'vault-metadata': 2,
      'service-worker': 3,
      'cached-responses': 3,
    });
    expect(a.blockers).toEqual([]);

    const futurenet = findWallet(inventory, { ...SCOPE_A, network: 'futurenet' })!;
    expect(futurenet.items['vault-metadata']).toHaveLength(1);
    expect(futurenet.items['cached-responses'].map((entry) => entry.url)).toEqual([
      `https://horizon-futurenet.stellar.org/accounts/${WALLET_A}`,
    ]);

    const device = Object.fromEntries(inventory.device.map((c) => [c.id, c.itemCount]));
    expect(device).toMatchObject({
      contacts: 1,
      notifications: 2,
      'auction-data': 2,
      'key-vault': 2,
      'push-subscriptions': 1,
      preferences: 1,
      'wallet-connection': 1,
      'other-app-data': 0,
    });
    expect(inventory.dataCaches).toEqual([{ name: 'wraith-rpc-v2', entries: 7 }]);
    expect(inventory.shellCaches.sort()).toEqual(['wraith-assets-v2', 'wraith-precache-v2']);
  });

  it('keeps untagged queue and retry records out of every wallet', async () => {
    const env = backends();
    env.storage.setItem(
      OFFLINE_QUEUE_STORAGE_KEY,
      JSON.stringify({
        version: CURRENT_STORAGE_VERSION,
        data: [
          createOfflineEntry('signed-submit', { chain: 'stellar', txHash: TX_A, signedXdr: 'x' }),
        ],
      }),
    );
    env.storage.setItem(
      LOCAL_DATA_STORAGE_KEYS.submissions,
      JSON.stringify({
        version: 1,
        operations: { orphan: { operationId: 'orphan', draftKey: '', status: 'submitting' } },
        drafts: {},
      }),
    );

    const inventory = await readLocalDataInventory(env.value, OPTIONS);
    expect(inventory.wallets).toEqual([]);
    expect(inventory.deviceItems['unlinked-records'].map((record) => record.kind)).toEqual([
      'offline-entry',
      'submission',
    ]);
    expect(inventory.deviceBlockers.map((blocker) => blocker.kind)).toEqual([
      'signed',
      'ambiguous',
    ]);
  });
});

describe('wallet-scoped deletion', () => {
  it('clears localStorage, IndexedDB, Cache Storage and worker records for one wallet only', async () => {
    const env = seeded();
    const before = await readLocalDataInventory(env.value, OPTIONS);
    const untouchedB = findWallet(before, SCOPE_B)!;
    const untouchedFuturenet = findWallet(before, { ...SCOPE_A, network: 'futurenet' })!;

    const report = await deleteWalletData(
      env.value,
      { scope: SCOPE_A, categories: [...WALLET_CATEGORY_IDS] },
      OPTIONS,
    );

    expect(report.verified).toBe(true);
    expect(report.worker).toBe('acknowledged');
    expect(env.worker.requests).toEqual([{ scope: 'wallet', publicKey: WALLET_A }]);

    // localStorage
    expect(env.storage.getItem(`${WALLET_A}:${STEALTH_A}`)).toBeNull();
    expect(
      env.storage.getItem(`${LOCAL_DATA_STORAGE_KEYS.scanCursorPrefix}${WALLET_A}`),
    ).toBeNull();
    expect(env.storage.getItem(`${LOCAL_DATA_STORAGE_KEYS.vaultSentPrefix}${WALLET_A}`)).toBeNull();
    expect(env.storage.getItem(vaultKey(WALLET_A, 'testnet'))).toBeNull();
    const activity = JSON.parse(env.storage.getItem(LOCAL_DATA_STORAGE_KEYS.activity)!);
    expect(activity.state.entries.map((e: { wallet: string }) => e.wallet)).toEqual([WALLET_B]);
    const submissions = JSON.parse(env.storage.getItem(LOCAL_DATA_STORAGE_KEYS.submissions)!);
    expect(Object.keys(submissions.operations)).toEqual([`op-${WALLET_B.slice(1, 5)}`]);
    expect(Object.keys(submissions.drafts)).toEqual([TX_B]);

    // IndexedDB + service-worker records
    const { worker, scanKeys } = LOCAL_DATA_DATABASES;
    expect(env.idb.store(worker.name, worker.accounts).has(WALLET_A)).toBe(false);
    expect(env.idb.store(scanKeys.name, scanKeys.sealed).has(WALLET_A)).toBe(false);
    expect(env.idb.store(scanKeys.name, scanKeys.wrapping).has(WALLET_A)).toBe(false);

    // Cache Storage: A's testnet entries are gone; its futurenet entry and B's remain.
    expect(env.caches.caches.get('wraith-rpc-v2')!.sort()).toEqual(
      [
        `https://horizon-futurenet.stellar.org/accounts/${WALLET_A}`,
        `https://horizon-testnet.stellar.org/accounts/${WALLET_B}`,
        `https://horizon-testnet.stellar.org/accounts/${STEALTH_B}/payments`,
        `https://horizon-testnet.stellar.org/transactions/${TX_B}`,
      ].sort(),
    );

    // Nothing belonging to another wallet, another network or the device changed.
    const after = await readLocalDataInventory(env.value, OPTIONS);
    expect(findWallet(after, SCOPE_A)).toBeUndefined();
    expect(findWallet(after, SCOPE_B)).toEqual(untouchedB);
    expect(findWallet(after, { ...SCOPE_A, network: 'futurenet' })).toEqual(untouchedFuturenet);
    expect(after.device).toEqual(before.device);
    expect(env.idb.store(worker.name, worker.accounts).has('BP256DH-KEY')).toBe(true);
    expect(env.storage.getItem('wagmi.store')).not.toBeNull();
  });

  it('deletes only the selected categories', async () => {
    const env = seeded();
    await deleteWalletData(
      env.value,
      { scope: SCOPE_A, categories: ['labels', 'scan-cursor'] },
      OPTIONS,
    );

    const a = findWallet(await readLocalDataInventory(env.value, OPTIONS), SCOPE_A)!;
    const counts = Object.fromEntries(a.categories.map((c) => [c.id, c.itemCount]));
    expect(counts.labels).toBe(0);
    expect(counts['scan-cursor']).toBe(0);
    expect(counts.activity).toBe(1);
    expect(counts['service-worker']).toBe(3);
    expect(env.worker.requests).toEqual([]);
  });

  it('removes the worker record from the page when no service worker answers', async () => {
    const env = seeded();
    env.worker.active = false;

    const report = await deleteWalletData(
      env.value,
      { scope: SCOPE_A, categories: ['service-worker'] },
      OPTIONS,
    );

    expect(report.worker).toBe('direct');
    expect(report.verified).toBe(true);
    const { worker } = LOCAL_DATA_DATABASES;
    expect(env.idb.store(worker.name, worker.accounts).has(WALLET_A)).toBe(false);
    expect(env.idb.store(worker.name, worker.accounts).has(WALLET_B)).toBe(true);
  });

  it('refuses while signed or ambiguous transactions are unresolved', async () => {
    const env = seeded();
    const activity = JSON.parse(env.storage.getItem(LOCAL_DATA_STORAGE_KEYS.activity)!);
    activity.state.entries.push(activityEntry('c'.repeat(64), WALLET_A, 'pending'));
    env.storage.setItem(LOCAL_DATA_STORAGE_KEYS.activity, JSON.stringify(activity));
    const queue = JSON.parse(env.storage.getItem(OFFLINE_QUEUE_STORAGE_KEY)!);
    const signed = createOfflineEntry('signed-submit', {
      chain: 'stellar',
      wallet: WALLET_A,
      txHash: 'd'.repeat(64),
      signedXdr: 'x',
    });
    queue.data.push({ ...signed, status: 'needs-review' });
    env.storage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(queue));
    const submissions = JSON.parse(env.storage.getItem(LOCAL_DATA_STORAGE_KEYS.submissions)!);
    submissions.operations['op-lost'] = {
      operationId: 'op-lost',
      draftKey: '',
      status: 'submitting',
      txHash: 'e'.repeat(64),
      metadata: { wallet: WALLET_A },
    };
    env.storage.setItem(LOCAL_DATA_STORAGE_KEYS.submissions, JSON.stringify(submissions));
    const snapshot = new Map(env.storage.values);

    const attempt = deleteWalletData(
      env.value,
      { scope: SCOPE_A, categories: [...WALLET_CATEGORY_IDS] },
      OPTIONS,
    );
    await expect(attempt).rejects.toBeInstanceOf(LocalDataBlockedError);
    const error = (await attempt.catch((e: unknown) => e)) as LocalDataBlockedError;
    expect(error.blockers.map((b) => [b.id, b.kind])).toEqual([
      [`activity:${'c'.repeat(64)}`, 'ambiguous'],
      [`offline:${signed.id}`, 'signed'],
      ['submission:op-lost', 'ambiguous'],
    ]);
    // A refused deletion changes nothing.
    expect(env.storage.values).toEqual(snapshot);
    expect(env.worker.requests).toEqual([]);

    // A blocker in a category that is not selected does not block.
    await deleteWalletData(env.value, { scope: SCOPE_A, categories: ['labels'] }, OPTIONS);

    const report = await deleteWalletData(
      env.value,
      {
        scope: SCOPE_A,
        categories: [...WALLET_CATEGORY_IDS],
        resolvedBlockerIds: error.blockers.map((b) => b.id),
      },
      OPTIONS,
    );
    expect(report.verified).toBe(true);
    expect(findWallet(await readLocalDataInventory(env.value, OPTIONS), SCOPE_B)).toBeDefined();
  });
});

describe('local data export', () => {
  const schema = JSON.parse(
    readFileSync(new URL('../schema/local-data-export.json', import.meta.url), 'utf8'),
  );
  const validate = new Ajv2020({ strict: true }).compile(schema);

  it('is versioned, discloses every category and validates against the schema', async () => {
    const env = seeded();
    const wallet = findWallet(await readLocalDataInventory(env.value, OPTIONS), SCOPE_A)!;
    const document = buildWalletExport(
      wallet,
      ['labels', 'offline-intents', 'service-worker'],
      OPTIONS.now(),
    );

    expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
    expect(document).toMatchObject({
      type: 'wraith-local-data-export',
      schemaVersion: 1,
      exportedAt: '2026-11-21T00:00:00.000Z',
      scope: { kind: 'wallet', ...SCOPE_A },
    });
    expect(document.categories.map((c) => c.id)).toEqual([...WALLET_CATEGORY_IDS]);
    expect(document.categories.filter((c) => c.included).map((c) => c.id)).toEqual([
      'labels',
      'offline-intents',
      'service-worker',
    ]);
    expect(Object.keys(document.data).sort()).toEqual([
      'labels',
      'offline-intents',
      'service-worker',
    ]);
    expect(document.withheld).toEqual([
      expect.objectContaining({ id: 'service-worker', reason: 'encrypted' }),
    ]);
    expect(document.data['service-worker']).toEqual([
      { publicKey: WALLET_A, lastScannedLedger: 99, timestamp: 1 },
    ]);
  });

  it('never contains secrets or ciphertext, even with every category selected', async () => {
    const env = seeded();
    const inventory = await readLocalDataInventory(env.value, OPTIONS);
    const documents = [
      buildWalletExport(findWallet(inventory, SCOPE_A)!, [...WALLET_CATEGORY_IDS]),
      buildDeviceExport(inventory, [...DEVICE_CATEGORY_IDS]),
    ];

    for (const document of documents) {
      expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
      const json = JSON.stringify(document);
      for (const marker of SECRET_MARKERS) expect(json).not.toContain(marker);
    }

    const device = documents[1];
    expect(device.data['auction-data']).toEqual([{ name: 'ada', endsAt: 5 }]);
    expect(device.data).not.toHaveProperty('key-vault');
    expect(device.data).not.toHaveProperty('push-subscriptions');
    expect(device.categories.find((c) => c.id === 'key-vault')?.included).toBe(false);
    expect(device.withheld.map((w) => w.id).sort()).toEqual([
      'auction-data',
      'key-vault',
      'push-subscriptions',
    ]);
  });
});

describe('full local reset', () => {
  it('summarises precisely what is removed and what is kept', async () => {
    const env = seeded();
    const summary = buildResetSummary(await readLocalDataInventory(env.value, OPTIONS));

    expect(summary.wallets.map((wallet) => wallet.scope.wallet)).toEqual([
      WALLET_A,
      WALLET_A,
      WALLET_B,
    ]);
    expect(summary.caches).toEqual([{ name: 'wraith-rpc-v2', entries: 7 }]);
    expect(summary.kept.some((line) => line.startsWith('wraith-precache-v2'))).toBe(true);
    expect(summary.totalItems).toBe(
      summary.wallets.flatMap((w) => w.categories).reduce((t, c) => t + c.itemCount, 0) +
        summary.device.reduce((t, c) => t + c.itemCount, 0) +
        7,
    );
  });

  it('requires the typed confirmation and resolution of open transactions', async () => {
    const env = seeded();
    const vault = JSON.stringify({
      version: 1,
      watchedAuctions: [],
      encryptedBids: { kdf: {}, cipher: {} },
    });
    env.storage.setItem(LOCAL_DATA_STORAGE_KEYS.auctionVault, vault);

    await expect(resetAllLocalData(env.value, { confirmation: 'reset' }, OPTIONS)).rejects.toThrow(
      FULL_RESET_CONFIRMATION,
    );
    await expect(
      resetAllLocalData(env.value, { confirmation: FULL_RESET_CONFIRMATION }, OPTIONS),
    ).rejects.toMatchObject({ blockers: [expect.objectContaining({ id: 'auction-vault' })] });
    expect(env.storage.getItem(LOCAL_DATA_STORAGE_KEYS.auctionVault)).toBe(vault);
  });

  it('removes every app record and leaves the app shell and third-party state', async () => {
    const env = seeded();

    const report = await resetAllLocalData(
      env.value,
      { confirmation: FULL_RESET_CONFIRMATION },
      OPTIONS,
    );

    expect(report.verified).toBe(true);
    expect(report.worker).toBe('acknowledged');
    expect(env.worker.requests).toEqual([{ scope: 'all' }]);
    expect(env.worker.pushSubscribed).toBe(false);
    expect([...env.storage.values.keys()].sort()).toEqual(['unrelated-app', 'wagmi.store']);
    for (const [, stores] of env.idb.databases) {
      for (const [, records] of stores) expect(records.size).toBe(0);
    }
    expect([...env.caches.caches.keys()].sort()).toEqual([
      'wraith-assets-v2',
      'wraith-precache-v2',
    ]);
  });
});
