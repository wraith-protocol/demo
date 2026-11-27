import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '../e2e/fixtures';

const CANARY = 'WRAITH_CANARY_ABC123';
const WALLET_ADDRESS = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';
const VAULT_DATABASE = 'wraith-key-vault';

function writeJson(directory: string, name: string, value: unknown): void {
  writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
}

function expectNoCanary(value: string, label: string): void {
  expect(value, `${label} contains the seeded canary`).not.toContain(CANARY);
}

test('seeded secret export flow leaves no secrets in test artifacts', async ({
  context,
  page,
  freighter,
}, testInfo) => {
  test.setTimeout(120_000);
  const consoleLines: string[] = [];
  page.on('console', (message) => {
    consoleLines.push(JSON.stringify({ type: message.type(), text: message.text() }));
  });
  await context.addInitScript(
    ({ wallet, canary }) => {
      window.localStorage.setItem(
        'wraith-activity-storage',
        JSON.stringify({
          state: {
            entries: [
              {
                id: 'secret-scan-canary-tx',
                chain: 'stellar',
                wallet,
                kind: 'stealth-send',
                direction: 'out',
                status: 'confirmed',
                amount: '1',
                token: 'XLM',
                recipient: wallet,
                metadata: { memo: canary },
                timestamp: Date.now(),
              },
            ],
          },
          version: 0,
        }),
      );
    },
    { wallet: WALLET_ADDRESS, canary: CANARY },
  );

  await freighter.mock({ isConnected: true, address: WALLET_ADDRESS });
  await page.goto('/send');
  await page.getByLabel('Chain').selectOption('stellar');
  await page.getByRole('button', { name: 'Connect Freighter' }).click();
  await expect(page.getByRole('button', { name: 'Disconnect Stellar wallet' })).toBeVisible();

  await page.evaluate(
    ({ canary }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('wraith-key-vault', 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('entries')) {
            db.createObjectStore('entries', { keyPath: 'label' });
          }
          if (!db.objectStoreNames.contains('metadata')) {
            db.createObjectStore('metadata', { keyPath: 'id' });
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('entries', 'readwrite');
          tx.objectStore('entries').put({
            label: 'secret-scan-canary',
            iv: 'canary-iv',
            ciphertext: canary,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
        request.onerror = () => reject(request.error);
      }),
    { canary: CANARY },
  );

  await page.evaluate((secret) => console.log('secret-bearing export', secret), CANARY);
  await page.waitForFunction(() => {
    const raw = sessionStorage.getItem('wraith-secret-findings');
    if (!raw) return false;
    const findings = JSON.parse(raw) as Array<{ id?: string }>;
    return findings.some((finding) => finding.id === 'canary');
  });

  await page.getByRole('link', { name: 'Activity' }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page.getByRole('heading', { name: 'Activity History' })).toBeVisible({
    timeout: 60_000,
  });

  const directory = testInfo.outputPath('secret-scan');
  mkdirSync(directory, { recursive: true });

  const csvButton = page.getByRole('button', { name: 'Export CSV' });
  const jsonButton = page.getByRole('button', { name: 'Export JSON' });
  await expect(csvButton).toBeEnabled();
  await expect(jsonButton).toBeEnabled();

  const [csvDownload] = await Promise.all([page.waitForEvent('download'), csvButton.click()]);
  await csvDownload.saveAs(path.join(directory, 'export.csv'));
  const [jsonDownload] = await Promise.all([page.waitForEvent('download'), jsonButton.click()]);
  await jsonDownload.saveAs(path.join(directory, 'export.json'));

  const csvText = readFileSync(path.join(directory, 'export.csv'), 'utf8');
  const jsonText = readFileSync(path.join(directory, 'export.json'), 'utf8');
  expect(csvText.charCodeAt(0)).toBe(0xfeff);
  expect(csvText).toContain('[REDACTED:canary]');
  expect(jsonText).toContain('[REDACTED:canary]');
  expectNoCanary(csvText, 'CSV export');
  expectNoCanary(jsonText, 'JSON export');
  expect(Array.isArray(JSON.parse(jsonText))).toBe(true);

  const databaseNames = await page.evaluate(async () => {
    const factory = indexedDB as IDBFactory & {
      databases?: () => Promise<Array<{ name?: string }>>;
    };
    const discovered = typeof factory.databases === 'function' ? await factory.databases() : [];
    const names = discovered
      .map((database) => database.name)
      .filter((name): name is string => !!name);
    return Array.from(new Set(['wraith-key-vault', ...names]));
  });

  const snapshot = await page.evaluate(async (names) => {
    const secretScan = await import('/src/lib/secretScan.ts');
    const indexedDb = await secretScan.inspectIndexedDb(names);
    return { ...secretScan.snapshotSecretState(names), indexedDb };
  }, databaseNames);

  writeFileSync(path.join(directory, 'console.jsonl'), `${consoleLines.join('\n')}\n`);
  writeJson(directory, 'storage.json', snapshot.webStorage);
  writeJson(directory, 'indexeddb.json', snapshot.indexedDb);

  expect(snapshot.findings.some((finding) => finding.id === 'canary')).toBe(true);
  const vault = snapshot.indexedDb.find((database) => database.name === VAULT_DATABASE);
  expect(vault).toBeDefined();
  expect(vault!.version).toBeGreaterThan(0);
  expect(vault!.stores.map((store) => store.name)).toContain('entries');
  expect(vault!.stores.find((store) => store.name === 'entries')?.keyPath).toBe('label');
  expect(
    vault!.records.some(
      (record) =>
        record.store === 'entries' && JSON.stringify(record.value).includes('[REDACTED:canary]'),
    ),
  ).toBe(true);

  const consoleText = consoleLines.join('\n');
  expectNoCanary(consoleText, 'console artifact');
  expectNoCanary(JSON.stringify(snapshot.webStorage), 'web storage artifact');
  expectNoCanary(JSON.stringify(snapshot.indexedDb), 'IndexedDB artifact');
});
