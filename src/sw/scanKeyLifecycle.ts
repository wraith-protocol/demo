import { createIdbScanKeyBackend } from './idbScanKeyBackend';
import { lockAllScanKeys, type ScanKeyBackend } from './scanKeyStore';

/**
 * Locks every account's background-scan key. Called whenever the Stellar stealth
 * keys leave memory (wallet disconnect, app idle lock, leaving recovery mode).
 * Never rejects: a lock must not fail loudly or block the UI.
 */
export async function lockStellarScanKeys(backend?: ScanKeyBackend): Promise<void> {
  if (!backend && typeof indexedDB === 'undefined') return;
  try {
    await lockAllScanKeys(backend ?? createIdbScanKeyBackend());
  } catch (error) {
    console.error('[scan-keys] Failed to lock scan keys:', error);
  }
}
