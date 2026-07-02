const PRIVACY_WARNING_KEY = 'wraith:labels:privacy-warning-shown';
const MAX_LABEL_LENGTH = 64;

export interface StealthLabel {
  stealthAddress: string;
  label: string;
  tags: string[];
  hiddenAt?: number;
  createdAt: number;
}

function storageKey(walletPubkey: string, stealthAddress: string): string {
  return `${walletPubkey}:${stealthAddress}`;
}

function isLabelKey(key: string, walletPubkey: string): boolean {
  return key.startsWith(`${walletPubkey}:`) && key !== PRIVACY_WARNING_KEY;
}

function parseEntry(raw: string | null): StealthLabel | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StealthLabel;
  } catch {
    return null;
  }
}

export function getLabels(walletPubkey: string): Record<string, StealthLabel> {
  const result: Record<string, StealthLabel> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !isLabelKey(key, walletPubkey)) continue;
    const entry = parseEntry(localStorage.getItem(key));
    if (entry) {
      result[entry.stealthAddress] = entry;
    }
  }
  return result;
}

export function getLabel(walletPubkey: string, stealthAddress: string): StealthLabel | null {
  return parseEntry(localStorage.getItem(storageKey(walletPubkey, stealthAddress)));
}

export function saveLabel(
  walletPubkey: string,
  stealthAddress: string,
  label: string,
  tags: string[],
): StealthLabel {
  const key = storageKey(walletPubkey, stealthAddress);
  const existing = parseEntry(localStorage.getItem(key));
  const trimmedLabel = label.slice(0, MAX_LABEL_LENGTH);
  const cleanTags = tags.map((t) => t.trim().slice(0, MAX_LABEL_LENGTH)).filter(Boolean);

  const entry: StealthLabel = {
    stealthAddress,
    label: trimmedLabel,
    tags: cleanTags,
    hiddenAt: existing?.hiddenAt,
    createdAt: existing?.createdAt ?? Date.now(),
  };

  localStorage.setItem(key, JSON.stringify(entry));
  return entry;
}

export function hideAddress(walletPubkey: string, stealthAddress: string): void {
  const key = storageKey(walletPubkey, stealthAddress);
  const existing = parseEntry(localStorage.getItem(key));
  if (existing) {
    existing.hiddenAt = Date.now();
    localStorage.setItem(key, JSON.stringify(existing));
  } else {
    const entry: StealthLabel = {
      stealthAddress,
      label: '',
      tags: [],
      hiddenAt: Date.now(),
      createdAt: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(entry));
  }
}

export function unhideAddress(walletPubkey: string, stealthAddress: string): void {
  const key = storageKey(walletPubkey, stealthAddress);
  const existing = parseEntry(localStorage.getItem(key));
  if (existing) {
    delete existing.hiddenAt;
    localStorage.setItem(key, JSON.stringify(existing));
  }
}

export function deleteLabel(walletPubkey: string, stealthAddress: string): void {
  localStorage.removeItem(storageKey(walletPubkey, stealthAddress));
}

export function getAllTags(walletPubkey: string): string[] {
  const labels = getLabels(walletPubkey);
  const tagSet = new Set<string>();
  for (const entry of Object.values(labels)) {
    for (const tag of entry.tags) {
      tagSet.add(tag);
    }
  }
  return Array.from(tagSet).sort();
}

export function exportLabels(walletPubkey: string): string {
  const labels = getLabels(walletPubkey);
  return JSON.stringify(labels, null, 2);
}

export interface ImportResult {
  imported: number;
  conflicts: Array<{
    stealthAddress: string;
    existingLabel: string;
    incomingLabel: string;
  }>;
}

export function importLabels(
  walletPubkey: string,
  json: string,
  overwriteConflicts: boolean = false,
): ImportResult {
  const incoming = JSON.parse(json) as Record<string, StealthLabel>;
  const conflicts: ImportResult['conflicts'] = [];
  let imported = 0;

  for (const [addr, entry] of Object.entries(incoming)) {
    const key = storageKey(walletPubkey, addr);
    const existing = parseEntry(localStorage.getItem(key));
    if (existing && existing.label && existing.label !== entry.label) {
      if (overwriteConflicts) {
        localStorage.setItem(key, JSON.stringify(entry));
        imported++;
      } else {
        conflicts.push({
          stealthAddress: addr,
          existingLabel: existing.label,
          incomingLabel: entry.label,
        });
      }
    } else {
      localStorage.setItem(key, JSON.stringify(entry));
      imported++;
    }
  }

  return { imported, conflicts };
}

export function mergeConflicts(
  walletPubkey: string,
  resolutions: Record<string, StealthLabel>,
): void {
  for (const [addr, entry] of Object.entries(resolutions)) {
    localStorage.setItem(storageKey(walletPubkey, addr), JSON.stringify(entry));
  }
}

export function hasShownPrivacyWarning(): boolean {
  return localStorage.getItem(PRIVACY_WARNING_KEY) === 'true';
}

export function markPrivacyWarningShown(): void {
  localStorage.setItem(PRIVACY_WARNING_KEY, 'true');
}
