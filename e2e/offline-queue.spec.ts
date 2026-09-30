import { test, expect } from './fixtures';

/**
 * Offline queue + reconnect reconciliation (Wave 9, #184).
 *
 * Covers the documented offline policy end to end:
 * - the queue-aware offline banner while disconnected,
 * - queueing a real payment intent through the Send UI while offline,
 * - reconciliation on reconnect (review / conflict outcomes),
 * - signing-required envelopes never auto-broadcasting.
 *
 * Seeded entries use the versioned storage envelope the queue library owns:
 * `{ version: 1, data: [...] }` under `wraith-offline-queue`.
 */

const QUEUE_KEY = 'wraith-offline-queue';
const VALID_META =
  'st:xlm:5a1922b5614eed2ef72ebad40abc5d014f7c27b6e1de5dc36976e9eec4cbe29e6b912a495f9f14513d54a00a7887f986d394a30a77239475caf211e8094b6cdb';

interface SeedEntry {
  id: string;
  kind: string;
  policy: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
}

function seedEntry(partial: Partial<SeedEntry> & { id: string; kind: string }): SeedEntry {
  const now = Date.now();
  const policy = partial.kind === 'signed-submit' ? 'signing-required' : 'safe-to-queue';
  return {
    policy,
    status: 'queued',
    createdAt: now - 1000,
    updatedAt: now - 1000,
    attempts: 0,
    maxAttempts: 5,
    payload: {},
    ...partial,
  } as SeedEntry;
}

async function seedQueue(context: import('@playwright/test').BrowserContext, entries: SeedEntry[]) {
  await context.addInitScript(
    ({ key, items }) => {
      window.localStorage.setItem(key, JSON.stringify({ version: 1, data: items }));
    },
    { key: QUEUE_KEY, items: entries },
  );
}

test.describe('Offline queue and reconciliation', () => {
  test('offline banner shows queued count and queue survives reload', async ({ page, context }) => {
    await seedQueue(context, [
      seedEntry({
        id: 'seed-intent-1',
        kind: 'payment-intent',
        payload: {
          chain: 'stellar',
          recipient: VALID_META,
          amount: '10',
          asset: 'XLM',
          source: 'form',
          expiresAt: Date.now() + 3600_000,
        },
      }),
      seedEntry({
        id: 'seed-scan-1',
        kind: 'scan-session',
        payload: { source: 'camera', rawText: VALID_META, capturedAt: Date.now() - 1000 },
      }),
    ]);

    await page.goto('/send');
    await page.getByLabel('Chain').selectOption('stellar');

    // Seeded work reconciles on load while online: intent waits for review,
    // the scan completes.
    const panel = page.getByTestId('offline-queue-panel');
    await expect(panel).toBeVisible();
    await expect(
      panel.getByTestId('offline-queue-entry').filter({ hasText: 'Needs review' }),
    ).toBeVisible();

    // Going offline surfaces the banner; the needs-review item stays visible.
    await context.setOffline(true);
    await expect(page.getByText("You're offline.")).toBeVisible();

    // Reloading online keeps the persisted queue (nothing is lost).
    await context.setOffline(false);
    await page.reload();
    await expect(page.getByTestId('offline-queue-panel')).toBeVisible();
    await expect(
      page.getByTestId('offline-queue-entry').filter({ hasText: 'Needs review' }),
    ).toBeVisible();
  });

  test('sending while offline queues a payment intent, reconciles on reconnect', async ({
    page,
    context,
    freighter,
    horizon,
  }) => {
    const mockAddress = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';
    await freighter.mock({ isConnected: true, address: mockAddress });
    await horizon.mock({ accountExists: true, txSuccess: true });

    await page.goto('/send');
    await page.getByLabel('Chain').selectOption('stellar');
    await page.getByRole('button', { name: 'Connect Freighter' }).click();

    await page.getByPlaceholder('st:xlm:...').fill(VALID_META);
    await page.getByPlaceholder('0.0').fill('25');

    // Drop the connection: the send becomes a persisted intent, not a failure.
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Send Privately' }).click();

    await expect(page.getByText(/send was queued/)).toBeVisible();
    await expect(page.getByText("You're offline.")).toBeVisible();
    await expect(page.getByTestId('offline-queue-count')).toHaveText('1 item queued');

    // Reconnect: the intent reconciles to needs-review for explicit signing.
    await context.setOffline(false);
    const panel = page.getByTestId('offline-queue-panel');
    const entry = panel
      .getByTestId('offline-queue-entry')
      .filter({ hasText: 'Needs review' })
      .first();
    await expect(entry).toBeVisible();
    await expect(entry.getByRole('button', { name: 'Review in Send' })).toBeVisible();

    // Reviewing prefills the Send form from the queued intent.
    await entry.getByRole('button', { name: 'Review in Send' }).click();
    await expect(page).toHaveURL(/to=/);
  });

  test('expired intents conflict and signed envelopes never auto-broadcast', async ({
    page,
    context,
  }) => {
    let broadcastPosts = 0;
    await page.route('https://horizon-testnet.stellar.org/transactions', async (route) => {
      if (route.request().method() === 'POST') {
        broadcastPosts += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ hash: 'explicit_broadcast_hash', ledger: 101 }),
        });
      } else {
        await route.continue();
      }
    });

    await seedQueue(context, [
      seedEntry({
        id: 'seed-expired-intent',
        kind: 'payment-intent',
        payload: {
          chain: 'stellar',
          recipient: VALID_META,
          amount: '5',
          asset: 'XLM',
          source: 'payment-link',
          expiresAt: Date.now() - 60_000,
        },
      }),
      seedEntry({
        id: 'seed-signed-1',
        kind: 'signed-submit',
        payload: { chain: 'stellar', txHash: 'deadbeef', signedXdr: 'AAAA' },
      }),
    ]);

    await page.goto('/send');

    const panel = page.getByTestId('offline-queue-panel');
    await expect(panel).toBeVisible();

    // The expired link is a conflict with a plain-language reason…
    const conflict = panel
      .getByTestId('offline-queue-entry')
      .filter({ hasText: 'Conflict' })
      .first();
    await expect(conflict).toBeVisible();
    await expect(conflict.getByText(/expired before reconnect/)).toBeVisible();

    // …and the signed envelope waits for review instead of broadcasting itself.
    const held = panel
      .getByTestId('offline-queue-entry')
      .filter({ hasText: 'Needs review' })
      .first();
    await expect(held).toBeVisible();
    expect(broadcastPosts).toBe(0);

    // Reconnect notice links to the review surface.
    const notice = page.getByRole('status', { name: 'Network status' });
    await expect(notice).toContainText(/2 queued items need review/);
    await expect(notice.getByRole('link', { name: 'Review' })).toBeVisible();

    // Explicit two-step confirmation is the only broadcast path.
    await held.getByRole('button', { name: 'Broadcast now' }).click();
    await held.getByRole('button', { name: 'Confirm broadcast' }).click();
    const broadcast = panel.getByTestId('offline-queue-entry').filter({ hasText: 'deadbeef' });
    await expect(broadcast.filter({ hasText: 'Done' })).toBeVisible();
    expect(broadcastPosts).toBe(1);

    // Finished work can be cleared.
    await panel.getByRole('button', { name: 'Clear finished' }).click();
    await expect(panel.getByTestId('offline-queue-entry')).toHaveCount(0);
  });
});
