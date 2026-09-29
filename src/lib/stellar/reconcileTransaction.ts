import { STELLAR_NETWORK } from '@/config';

/** How many times to retry a 404 before treating it as truly absent. */
const MAX_404_RETRIES = 3;
/** Delay between 404 retries in ms. */
const RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reconcile a transaction with Horizon to check if it actually succeeded
 * despite a client-side timeout or error.
 *
 * A 404 from Horizon is NOT treated as an immediate final failure — the tx
 * may still be in-flight or the node may be lagging.  We retry up to
 * MAX_404_RETRIES times before concluding the tx is absent.
 *
 * Network / 5xx errors are also retried so a temporary Horizon outage does
 * not permanently fail a tx that was broadcast successfully.
 *
 * @param txHash - The transaction hash to reconcile
 * @returns Promise<boolean | null>
 *   - `true`  → confirmed on Horizon
 *   - `false` → definitively absent after all retries
 *   - `null`  → Horizon unavailable; caller should keep the intent pending
 */
export async function reconcileStellarTransaction(txHash: string): Promise<boolean | null> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_404_RETRIES; attempt++) {
    try {
      const response = await fetch(`${STELLAR_NETWORK.horizonUrl}/transactions/${txHash}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        const data = await response.json();
        return data.successful === true;
      }

      if (response.status === 404) {
        // Horizon may still be processing — retry before declaring absent
        if (attempt < MAX_404_RETRIES) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        // Exhausted retries — tx is genuinely absent
        return false;
      }

      // 5xx / 429 / other — Horizon is unhealthy; keep pending
      return null;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_404_RETRIES) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  console.error('[Reconcile] Network error after retries:', lastError);
  // Network completely unavailable — keep pending so we retry on next poll
  return null;
}
