import { expect, test, type Page } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:5178' });
test.describe.configure({ mode: 'default' });

async function install(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(page.getByText('Checking the application version', { exact: false })).toHaveCount(0);
}

async function deploy(page: Page) {
  await page.request.post('/__deploy');
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())!.update();
  });
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
}

test('idle update preserves the unsigned draft and does not rebroadcast a submitted operation', async ({
  page,
}) => {
  await install(page);
  await page.getByLabel('Recipient').fill('unsigned recipient draft');
  await page.getByRole('button', { name: 'Submit operation' }).click();
  await expect(page.locator('output')).toHaveText('submitted');
  await deploy(page);
  await page.evaluate(async () => {
    await caches.open('wraith-assets-v0');
  });
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    page.getByRole('button', { name: 'Reload', exact: true }).click(),
  ]);
  await expect(page.getByLabel('Recipient')).toHaveValue('unsigned recipient draft');
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Submit operation' }).click();
  await expect(page.locator('output')).toHaveText('submitted');
  expect(await page.evaluate(() => localStorage.getItem('fixture-broadcasts'))).toBe('1');
  expect(await page.evaluate(() => caches.has('wraith-assets-v0'))).toBe(false);
});

for (const phase of ['simulating', 'signing', 'submitting', 'reconciling']) {
  test(`defers activation during ${phase}, including a direct worker message`, async ({ page }) => {
    await install(page);
    await page.getByRole('button', { name: phase, exact: true }).click();
    await deploy(page);
    await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeDisabled();
    const ready = await page.evaluate(async () => {
      const waiting = (await navigator.serviceWorker.getRegistration())!.waiting!;
      return new Promise<boolean>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => resolve(event.data.ready);
        waiting.postMessage({ type: 'SKIP_WAITING' }, [channel.port2]);
      });
    });
    expect(ready).toBe(false);
    await expect(page.locator('output')).toHaveText(phase);
    await page.getByRole('button', { name: 'Finish transaction' }).click();
    await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeEnabled();
  });
}

test('offline update waits for reconnect and keeps the draft', async ({ page, context }) => {
  await install(page);
  await page.getByLabel('Recipient').fill('offline draft');
  await deploy(page);
  await context.setOffline(true);
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Recipient')).toHaveValue('offline draft');
  await context.setOffline(false);
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeEnabled();
});

test('a busy sibling tab vetoes reload and preserves old caches until it finishes', async ({
  page,
  context,
}) => {
  await install(page);
  const sibling = await context.newPage();
  await install(sibling);
  await sibling.getByRole('button', { name: 'signing', exact: true }).click();
  await deploy(page);
  await page.evaluate(async () => {
    await caches.open('wraith-assets-v0');
  });
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('open tab is busy');
  expect(await page.evaluate(() => caches.has('wraith-assets-v0'))).toBe(true);
  await sibling.getByRole('button', { name: 'Finish transaction' }).click();
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    page.getByRole('button', { name: 'Reload', exact: true }).click(),
  ]);
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toHaveCount(0);
});

test('unknown persisted transaction schemas block submission without deleting saved state', async ({
  page,
}) => {
  await install(page);
  const saved = JSON.stringify({ version: 999, operations: { pending: 'preserve' } });
  await page.evaluate(
    (raw) => localStorage.setItem('wraith-submission-idempotency-v1', raw),
    saved,
  );
  await page.getByRole('button', { name: 'Submit operation' }).click();
  await expect(page.locator('output')).toContainText(
    'different application or transaction version',
  );
  expect(await page.evaluate(() => localStorage.getItem('wraith-submission-idempotency-v1'))).toBe(
    saved,
  );
  expect(await page.evaluate(() => localStorage.getItem('fixture-broadcasts'))).toBeNull();
});

test('a mixed-version worker API blocks value-moving actions with recovery guidance', async ({
  page,
}) => {
  await install(page);
  await page.request.post('/__deploy?incompatible-api');
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())!.update();
  });
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    page.getByRole('button', { name: 'Reload', exact: true }).click(),
  ]);
  await expect(page.getByRole('status', { name: 'Application update' })).toContainText(
    'different application or transaction version',
  );
  await page.getByRole('button', { name: 'Submit operation' }).click();
  await expect(page.locator('output')).toContainText(
    'different application or transaction version',
  );
  expect(await page.evaluate(() => localStorage.getItem('fixture-broadcasts'))).toBeNull();
});
