import { test, expect } from '@playwright/test';

test.describe('KeyVault', () => {
  test('stores encrypted entries and restores them after unlock', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const { KeyVault } = await import('/src/vault');
      const dbName = `vault-${crypto.randomUUID()}`;
      const vault = new KeyVault({ dbName, idleTimeoutMs: 10_000 });
      const secret = {
        spendingPubKey: new Uint8Array([1, 2, 3, 4]),
        viewingPubKey: new Uint8Array([5, 6, 7, 8]),
        label: 'stellar',
      };

      await vault.unlock('correct horse battery staple');
      await vault.put('stellar', secret);

      const restored = await vault.get<typeof secret>('stellar');
      const dbRequest = indexedDB.open(dbName, 1);
      const rawRecord = await new Promise<Record<string, unknown>>((resolve, reject) => {
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          const tx = db.transaction('entries', 'readonly');
          const store = tx.objectStore('entries');
          const request = store.get('stellar');
          request.onsuccess = () => resolve(request.result as Record<string, unknown>);
          request.onerror = () => reject(request.error);
        };
        dbRequest.onerror = () => reject(dbRequest.error);
      });

      await vault.lock();

      return {
        restored: restored
          ? {
              spendingPubKey: Array.from(restored.spendingPubKey),
              viewingPubKey: Array.from(restored.viewingPubKey),
              label: restored.label,
            }
          : null,
        rawRecord: {
          ...rawRecord,
          iv: Array.from(rawRecord.iv as Uint8Array),
          ciphertext: Array.from(rawRecord.ciphertext as Uint8Array),
        },
        unlockedAfterLock: vault.isUnlocked,
      };
    });

    expect(result.restored).toEqual({
      spendingPubKey: [1, 2, 3, 4],
      viewingPubKey: [5, 6, 7, 8],
      label: 'stellar',
    });
    expect(result.rawRecord).toMatchObject({
      label: 'stellar',
    });
    expect(JSON.stringify(result.rawRecord)).not.toContain('correct horse battery staple');
    expect(JSON.stringify(result.rawRecord)).not.toContain('spendingPubKey');
    expect(result.unlockedAfterLock).toBe(false);
  });

  test('auto-locks on idle and blur', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const { KeyVault } = await import('/src/vault');
      const vault = new KeyVault({ dbName: `vault-${crypto.randomUUID()}`, idleTimeoutMs: 40 });

      await vault.unlock('idle passphrase');
      await new Promise((resolve) => setTimeout(resolve, 70));
      const afterIdle = vault.isUnlocked;

      await vault.unlock('idle passphrase');
      window.dispatchEvent(new Event('blur'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      const afterBlur = vault.isUnlocked;

      return { afterIdle, afterBlur };
    });

    expect(result.afterIdle).toBe(false);
    expect(result.afterBlur).toBe(false);
  });
});
