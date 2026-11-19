import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test('representative send flow leaves no secrets in test artifacts', async ({ page }, testInfo) => {
  const consoleLines: string[] = [];
  page.on('console', (message) => {
    consoleLines.push(JSON.stringify({ type: message.type(), text: message.text() }));
  });

  await page.goto('/send');
  await expect(page).toHaveURL(/\/send/);

  const storage = await page.evaluate(() => {
    const snapshot = (store: Storage) => {
      const entries: Record<string, string> = {};
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index);
        if (key === null) continue;
        entries[key] = store.getItem(key) ?? '';
      }
      return entries;
    };
    return {
      localStorage: snapshot(window.localStorage),
      sessionStorage: snapshot(window.sessionStorage),
    };
  });

  const databaseNames = await page.evaluate(async () => {
    const factory = indexedDB as IDBFactory & {
      databases?: () => Promise<Array<{ name?: string }>>;
    };
    if (typeof factory.databases !== 'function') return [];
    const databases = await factory.databases();
    return databases.map((database) => database.name).filter((name): name is string => !!name);
  });

  const directory = testInfo.outputPath('secret-scan');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'console.jsonl'), `${consoleLines.join('\n')}\n`);
  writeFileSync(path.join(directory, 'storage.json'), JSON.stringify(storage, null, 2));
  writeFileSync(path.join(directory, 'indexeddb.json'), JSON.stringify({ databaseNames }, null, 2));

  const findings = storage.sessionStorage['wraith-secret-findings'];
  if (findings) {
    const records = JSON.parse(findings) as Array<Record<string, unknown>>;
    const lines = records.map((record) => JSON.stringify({ ...record, type: 'secret-finding' }));
    writeFileSync(path.join(directory, 'findings.jsonl'), `${lines.join('\n')}\n`);
  }
});
