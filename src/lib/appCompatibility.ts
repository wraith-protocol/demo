/** Bump these contracts when the shell protocol or persisted transaction shape changes. */
export const APP_VERSION = {
  shell: import.meta.env.VITE_APP_SHELL_VERSION ?? '3',
  api: 1,
  transactionSchema: 1,
} as const;
export const SUBMISSION_STORAGE_KEY = 'wraith-submission-idempotency-v1';
export const COMPATIBILITY_MESSAGE =
  'This tab uses a different application or transaction version. Finish active transactions in other tabs, then reload to update. Your saved transactions have been kept.';

export function compatibleVersion(value: unknown): boolean {
  const version = value as Partial<typeof APP_VERSION> | null;
  return (
    version?.shell === APP_VERSION.shell &&
    version.api === APP_VERSION.api &&
    version.transactionSchema === APP_VERSION.transactionSchema
  );
}

/** Inspect without deleting or migrating an envelope another client may own. */
export function transactionStorageError(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    for (const key of [SUBMISSION_STORAGE_KEY, 'wraith-offline-queue']) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const value = JSON.parse(raw);
      // The offline queue also accepts its original unversioned array.
      if (key === 'wraith-offline-queue' && Array.isArray(value)) continue;
      if (value?.version !== APP_VERSION.transactionSchema) return COMPATIBILITY_MESSAGE;
    }
    if (typeof sessionStorage !== 'undefined') {
      for (let index = 0; index < sessionStorage.length; index++) {
        const key = sessionStorage.key(index);
        if (!key?.startsWith('wraith-send-draft:')) continue;
        const saved = JSON.parse(sessionStorage.getItem(key)!);
        if (saved?.version !== APP_VERSION.transactionSchema) return COMPATIBILITY_MESSAGE;
      }
    }
    return null;
  } catch {
    return 'Saved transaction state could not be read. Keep this tab open and restore storage access before updating.';
  }
}
