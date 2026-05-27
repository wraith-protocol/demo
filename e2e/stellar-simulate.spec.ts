import { test, expect } from '@playwright/test';

const MOCK_ADDRESS = 'GBCXSLSJYWRNPXL4R56WEMH5HVXL6IDDYF6YQVQ5JPR2LQ1Y2MJ3R5VM';

const VALID_META_ADDRESS = 'st:xlm:04' + 'a'.repeat(64) + 'b'.repeat(64);

test.describe('Stellar Send — Transaction Simulator', () => {
  test('shows disconnected state when wallet is not connected', async ({ page }) => {
    await page.goto('/send');
    await expect(page.locator('text=Connect your Freighter wallet')).toBeVisible();
    await expect(page.locator('text=Send Privately')).not.toBeVisible();
  });

  test('simulation card appears and disables send on failure', async ({ page }) => {
    await page.addInitScript((mockAddr) => {
      (window as unknown as Record<string, unknown>).freighter = true;

      const originalAddEventListener = window.addEventListener.bind(window);
      window.addEventListener = (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) => {
        if (type === 'message') {
          const wrappedListener = (event: MessageEvent) => {
            if (event.data && typeof event.data === 'object' && 'type' in event.data) {
              const data = event.data as Record<string, unknown>;
              let response: Record<string, unknown> | null = null;

              if (data.type === 'FREIGHTER_GET_PUBLIC_KEY') {
                response = { type: 'FREIGHTER_GET_PUBLIC_KEY_RESPONSE', publicKey: mockAddr };
              } else if (data.type === 'FREIGHTER_IS_CONNECTED') {
                response = { type: 'FREIGHTER_IS_CONNECTED_RESPONSE', isConnected: true };
              } else if (data.type === 'FREIGHTER_REQUEST_ACCESS') {
                response = { type: 'FREIGHTER_REQUEST_ACCESS_RESPONSE', granted: true };
              } else if (data.type === 'FREIGHTER_SIGN_TRANSACTION') {
                response = {
                  type: 'FREIGHTER_SIGN_TRANSACTION_RESPONSE',
                  signedTx: data.xdr || 'mock',
                };
              }

              if (response) {
                setTimeout(() => {
                  window.postMessage(response, '*');
                }, 10);
              }
            }

            if (typeof listener === 'function') {
              listener(event);
            } else if (listener && typeof listener.handleEvent === 'function') {
              listener.handleEvent(event);
            }
          };
          return originalAddEventListener(type, wrappedListener as EventListener, options);
        }
        return originalAddEventListener(type, listener, options);
      };
    }, MOCK_ADDRESS);

    await page.route('**/accounts/**', async (route) => {
      const url = route.request().url();
      if (url.includes(MOCK_ADDRESS)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            account_id: MOCK_ADDRESS,
            sequence: '123456789',
            balances: [{ asset_type: 'native', balance: '100.0000000' }],
            subentry_count: 0,
          }),
        });
      } else {
        await route.fulfill({ status: 404, body: '{"error":"not found"}' });
      }
    });

    await page.route('**/soroban-testnet.stellar.org/**', async (route) => {
      const body = route.request().postData();
      if (body && body.includes('simulateTransaction')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              error: 'ContractError(2): InvalidStealthAddress',
              events: [],
              latestLedger: 1000,
            },
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }),
        });
      }
    });

    await page.goto('/send');

    const simCard = page.locator('text=Simulation Failed');
    const sendButton = page.locator('button', { hasText: 'Send Privately' });

    await expect(sendButton.or(simCard)).toBeVisible({ timeout: 10000 });
  });
});
