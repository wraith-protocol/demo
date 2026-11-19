import {
  findSecrets,
  maskSecret,
  redactSecrets,
  redactValue,
  toText,
} from './secretPatterns.mjs';

export * from './secretPatterns.mjs';

export interface SecretFindingRecord {
  id: string;
  label: string;
  source: string;
  at: number;
  preview: string;
}

const FINDINGS_KEY = 'wraith-secret-findings';
const MAX_FINDINGS = 200;
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;
const findings: SecretFindingRecord[] = [];
let guardInstalled = false;

function recordFinding(finding: SecretFindingRecord): void {
  findings.push(finding);
  if (findings.length > MAX_FINDINGS) findings.shift();

  try {
    sessionStorage.setItem(FINDINGS_KEY, JSON.stringify(findings));
  } catch {
    return;
  }

  window.dispatchEvent(new CustomEvent('wraith-secret-finding', { detail: finding }));
}

export function getSecretFindings(): SecretFindingRecord[] {
  return [...findings];
}

export function clearSecretFindings(): void {
  findings.length = 0;
  try {
    sessionStorage.removeItem(FINDINGS_KEY);
  } catch {
    return;
  }
}

export function installConsoleSecretGuard(): () => void {
  if (guardInstalled) return () => undefined;
  guardInstalled = true;

  const originals = new Map<string, (...args: unknown[]) => void>();

  for (const method of CONSOLE_METHODS) {
    const original = console[method].bind(console) as (...args: unknown[]) => void;
    originals.set(method, original);
    console[method] = (...args: unknown[]) => {
      for (const finding of findSecrets(toText(args))) {
        recordFinding({
          id: finding.id,
          label: finding.label,
          source: `console.${method}`,
          at: Date.now(),
          preview: finding.preview,
        });
      }
      original(...args.map((arg) => redactValue(arg)));
    };
  }

  return () => {
    for (const [method, original] of originals) {
      console[method as (typeof CONSOLE_METHODS)[number]] = original as never;
    }
    originals.clear();
    guardInstalled = false;
  };
}

export function scanWebStorage(): SecretFindingRecord[] {
  const areas = ['localStorage', 'sessionStorage'] as const;
  const records: SecretFindingRecord[] = [];

  for (const area of areas) {
    let store: Storage | undefined;
    try {
      store = window[area];
    } catch {
      continue;
    }
    if (!store) continue;
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key === null) continue;
      const value = store.getItem(key) ?? '';
      for (const finding of findSecrets(`${key}\n${value}`)) {
        records.push({
          id: finding.id,
          label: finding.label,
          source: `${area}:${key.slice(0, 48)}`,
          at: Date.now(),
          preview: finding.preview,
        });
      }
    }
  }

  return records;
}

export interface IndexedDbMetadataRow {
  database: string;
  store: string;
  key: string;
  value: unknown;
}

export function readIndexedDbMetadata(
  databaseNames: readonly string[],
): Promise<IndexedDbMetadataRow[]> {
  if (typeof indexedDB === 'undefined') return Promise.resolve([]);

  return Promise.all(
    databaseNames.map(
      (database) =>
        new Promise<IndexedDbMetadataRow[]>((resolve) => {
          const rows: IndexedDbMetadataRow[] = [];
          let request: IDBOpenDBRequest;
          try {
            request = indexedDB.open(database);
          } catch {
            resolve(rows);
            return;
          }
          request.onerror = () => resolve(rows);
          request.onblocked = () => resolve(rows);
          request.onsuccess = () => {
            const db = request.result;
            const storeNames = Array.from(db.objectStoreNames).slice(0, 20);
            if (storeNames.length === 0) {
              db.close();
              resolve(rows);
              return;
            }
            const tx = db.transaction(storeNames, 'readonly');
            let pending = storeNames.length;
            for (const store of storeNames) {
              const cursorRequest = tx.objectStore(store).openCursor();
              cursorRequest.onsuccess = () => {
                const cursor = cursorRequest.result;
                if (cursor && rows.length < 200) {
                  rows.push({
                    database,
                    store,
                    key: String(cursor.key),
                    value: redactValue(cursor.value),
                  });
                  cursor.continue();
                } else {
                  pending -= 1;
                  if (pending === 0) {
                    db.close();
                    resolve(rows);
                  }
                }
              };
              cursorRequest.onerror = () => {
                pending -= 1;
                if (pending === 0) {
                  db.close();
                  resolve(rows);
                }
              };
            }
          };
        }),
    ),
  ).then((groups) => groups.flat());
}

function storageEntries(store: Storage | undefined): Record<string, string> {
  const entries: Record<string, string> = {};
  if (!store) return entries;
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (key === null) continue;
    entries[key] = redactSecrets(store.getItem(key) ?? '');
  }
  return entries;
}

export function snapshotSecretState(databaseNames: readonly string[] = []) {
  const records = [...getSecretFindings(), ...scanWebStorage()];
  return {
    findings: records.map((record) => ({
      type: 'secret-finding',
      id: record.id,
      label: record.label,
      source: record.source,
      at: record.at,
      preview: record.preview,
    })),
    webStorage: {
      localStorage: storageEntries(window.localStorage),
      sessionStorage: storageEntries(window.sessionStorage),
    },
    databaseNames: [...databaseNames],
  };
}
