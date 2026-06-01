/**
 * stellar-scan-worker.ts  (compiled to public/stellar-scan-worker.js)
 *
 * Runs inside a Web Worker spawned by the service worker. Performs the
 * elliptic-curve stealth-scan against a batch of Stellar announcements,
 * returning only the ones that match the user's viewing key.
 *
 * Message in:
 *   { viewingKeyHex: string; spendingPubKeyHex: string; announcements: Announcement[] }
 *
 * Message out:
 *   { matches: MatchedPayment[] } | { error: string }
 *
 * We deliberately keep this file free of Vite/React so it can be loaded as a
 * plain Worker URL in both the SW and the main thread (for testing).
 */

// The SDK is available in the global scope when the SW imports the bundle.
// Here we use dynamic import() so the worker can be bundled standalone.

self.onmessage = async (evt) => {
  try {
    const { viewingKeyHex, spendingPubKeyHex, announcements } = evt.data as {
      viewingKeyHex: string;
      spendingPubKeyHex: string;
      announcements: StellarAnnouncement[];
    };

    // Dynamically import the SDK stealth scanner.
    // The build pipeline (vite) will inline this when bundling for the SW.
    const { scanAnnouncements } = await import(
      /* @vite-ignore */ '@wraith-protocol/sdk/chains/stellar'
    );

    const matches: MatchedPayment[] = scanAnnouncements(
      announcements,
      viewingKeyHex,
      spendingPubKeyHex,
    );

    self.postMessage({ matches });
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};

// ─── Types (duplicated here so the worker compiles standalone) ────────────────

interface StellarAnnouncement {
  ephemeralPubKey: string;
  stealthAddress: string;
  viewTag: string;
  amount?: string;
  ledger?: number;
  txHash?: string;
}

interface MatchedPayment {
  stealthAddress: string;
  amount: string;
  ephemeralPubKey: string;
  txHash?: string;
}