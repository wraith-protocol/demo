/**
 * src/workers/stellar-scan-worker.ts
 *
 * Compiled to  public/stellar-scan-worker.js  (IIFE, no imports) by
 * scripts/build-sw.sh.  This file must stay free of Vite/React imports.
 *
 * Message in:
 *   { viewingKeyHex: string; spendingPubKeyHex: string; announcements: StellarAnnouncement[] }
 *
 * Message out (success):
 *   { matches: MatchedPayment[] }
 *
 * Message out (error):
 *   { error: string }
 */

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

interface StellarAnnouncement {
  ephemeralPubKey: string;
  stealthAddress:  string;
  viewTag:         string;
  amount?:         string;
  ledger?:         number;
  txHash?:         string;
}

interface MatchedPayment {
  stealthAddress:  string;
  amount:          string;
  ephemeralPubKey: string;
  txHash?:         string;
}

self.onmessage = async (evt: MessageEvent) => {
  try {
    const {
      viewingKeyHex,
      spendingPubKeyHex,
      announcements,
    } = evt.data as {
      viewingKeyHex:     string;
      spendingPubKeyHex: string;
      announcements:     StellarAnnouncement[];
    };

    if (!viewingKeyHex || !Array.isArray(announcements)) {
      self.postMessage({ error: 'Invalid input: viewingKeyHex and announcements required' });
      return;
    }

    // Dynamic import so the SDK is only pulled in when the worker is actually
    // used.  The esbuild bundle step inlines this at build time.
    const sdk = await import(
      /* @vite-ignore */
      '@wraith-protocol/sdk/chains/stellar'
    );

    const matches: MatchedPayment[] = sdk.scanAnnouncements(
      announcements,
      viewingKeyHex,
      spendingPubKeyHex ?? '',
    );

    self.postMessage({ matches });
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};