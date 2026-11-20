import { expect, test } from '@playwright/test';

test('recovers an expired Stellar scanner cursor without a silent jump', async ({ page }) => {
  await page.route('https://soroban-testnet.stellar.org', async (route) => {
    const request = route.request().postDataJSON();
    if (request.method === 'getLatestLedger') {
      await route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: { sequence: 500 } } });
      return;
    }

    const startLedger = request.params?.startLedger;
    if (request.method === 'getEvents' && startLedger === 1) {
      await route.fulfill({
        json: {
          jsonrpc: '2.0',
          id: request.id,
          error: { message: 'startLedger must be within the ledger range: 250 - 500' },
        },
      });
      return;
    }

    await route.fulfill({
      json: { jsonrpc: '2.0', id: request.id, result: { events: [] } },
    });
  });
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const cursorKey = 'wraith-stellar-scan-cursor:GTEST';
    localStorage.setItem(cursorKey, '100');
    const { default: ScannerWorker } =
      await import('/src/workers/stellar-scanner.worker.ts?worker');
    const worker = new ScannerWorker();
    // The worker reports per-page progress before its terminal message, so wait
    // for the terminal one (SUCCESS / ERROR / RETENTION_GAP).
    const scan = (startLedger: number) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        worker.onmessage = (event) => {
          const type = (event.data as { type?: string })?.type;
          if (type === 'SUCCESS' || type === 'ERROR' || type === 'RETENTION_GAP') {
            resolve(event.data);
          }
        };
        worker.onerror = (event) => reject(new Error(event.message));
        worker.postMessage({
          rpcUrl: 'https://soroban-testnet.stellar.org',
          announcerContract: 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL',
          viewingKey: new Uint8Array(32),
          spendingPubKey: new Uint8Array(32),
          spendingScalar: 1n,
          strategy: 'balanced',
          startLedger,
        });
      });

    const expired = await scan(Number(localStorage.getItem(cursorKey)));
    const cursorAfterError = localStorage.getItem(cursorKey);
    const recovered = await scan(Number(expired.oldestAvailableLedger));
    if (recovered.type === 'SUCCESS') {
      localStorage.setItem(cursorKey, String(recovered.nextLedger));
    }
    worker.terminate();

    return { expired, cursorAfterError, recovered, finalCursor: localStorage.getItem(cursorKey) };
  });

  expect(result.expired).toEqual({
    type: 'RETENTION_GAP',
    requestedLedger: 100,
    oldestAvailableLedger: 250,
  });
  expect(result.cursorAfterError).toBe('100');
  // `recovered` also carries the committed boundary and page/truncation stats.
  expect(result.recovered).toMatchObject({ type: 'SUCCESS', results: [], nextLedger: 501 });
  expect(result.finalCursor).toBe('501');
});
