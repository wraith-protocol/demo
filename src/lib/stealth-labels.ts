export interface StealthLabel {
  stealthAddress: string;
  label: string;
  tags: string[];
  hiddenAt?: number;
  createdAt: number;
}

export const MAX_LABEL_LENGTH = 64;
const STORAGE_PREFIX = 'wraith:labels:';
const PRIVACY_KEY = 'wraith:privacy-dismissed';

function getStorageKey(walletId: string): string {
  return `${STORAGE_PREFIX}${walletId}`;
}

export function getLabels(walletId: string): StealthLabel[] {
  try {
    const raw = localStorage.getItem(getStorageKey(walletId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function upsertLabel(walletId: string, label: StealthLabel): void {
  const labels = getLabels(walletId);
  const idx = labels.findIndex((l) => l.stealthAddress === label.stealthAddress);
  if (idx >= 0) {
    labels[idx] = { ...labels[idx], ...label, createdAt: labels[idx].createdAt };
  } else {
    labels.push(label);
  }
  localStorage.setItem(getStorageKey(walletId), JSON.stringify(labels));
}

export function removeLabel(walletId: string, stealthAddress: string): void {
  const labels = getLabels(walletId).filter((l) => l.stealthAddress !== stealthAddress);
  localStorage.setItem(getStorageKey(walletId), JSON.stringify(labels));
}

export function hideLabel(walletId: string, stealthAddress: string): void {
  const labels = getLabels(walletId);
  const idx = labels.findIndex((l) => l.stealthAddress === stealthAddress);
  if (idx >= 0) {
    labels[idx] = { ...labels[idx], hiddenAt: Date.now() };
    localStorage.setItem(getStorageKey(walletId), JSON.stringify(labels));
  }
}

export function unhideLabel(walletId: string, stealthAddress: string): void {
  const labels = getLabels(walletId);
  const idx = labels.findIndex((l) => l.stealthAddress === stealthAddress);
  if (idx >= 0) {
    const { hiddenAt: _, ...rest } = labels[idx];
    labels[idx] = rest;
    localStorage.setItem(getStorageKey(walletId), JSON.stringify(labels));
  }
}

export function exportLabels(walletId: string): StealthLabel[] {
  return getLabels(walletId);
}

export function importLabels(
  walletId: string,
  imported: StealthLabel[],
  overwrite: boolean,
): { merged: number; added: number } {
  const existing = getLabels(walletId);
  let merged = 0;
  let added = 0;

  for (const incoming of imported) {
    const idx = existing.findIndex((l) => l.stealthAddress === incoming.stealthAddress);
    if (idx >= 0) {
      if (overwrite) {
        existing[idx] = { ...existing[idx], ...incoming, createdAt: existing[idx].createdAt };
      }
      merged++;
    } else {
      existing.push({ ...incoming });
      added++;
    }
  }

  localStorage.setItem(getStorageKey(walletId), JSON.stringify(existing));
  return { merged, added };
}

export function isPrivacyDismissed(): boolean {
  return localStorage.getItem(PRIVACY_KEY) === '1';
}

export function dismissPrivacy(): void {
  localStorage.setItem(PRIVACY_KEY, '1');
}
