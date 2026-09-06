import { STELLAR_NETWORK } from '@/config';
import { getRpcLogs, getLastBroadcastTx, type RpcLogEntry } from './rpcLog';

export interface DebugBundle {
  version: 1;
  exportedAt: string;
  settings: Record<string, unknown>;
  activeProfileId: string | null;
  activityCount: number;
  notificationCount: number;
  rpcLog: RpcLogEntry[];
  lastError?: string | undefined;
  lastBroadcastTx?: string | null | undefined;
}

function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/S[A-Z0-9]{55}/g, '[REDACTED]')
      .replace(/[0-9a-fA-F]{64}/g, '[REDACTED]')
      .replace(
        /((?:"|')?(?:phrase|seed|mnemonic|secret)(?:"|')?\s*[:=]\s*)["'][^"']*["']/gi,
        '$1"[REDACTED]"'
      );
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redact(v);
    }
    return out;
  }
  return value;
}

function readStorage(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  } catch {
    return null;
  }
}

const SettingsKey = 'wraith-settings';
const ProfileKey = 'wraith-active-profile';
const ActivityKey = 'wraith-activity-count';
const NotificationKey = 'wraith-notification-count';
const LastErrorKey = 'wraith-last-error';

export function exportDebugBundle(): DebugBundle {
  const settings = (readStorage(SettingsKey) as Record<string, unknown> | null) ?? {};
  const activeProfileId = readStorage(ProfileKey) as string | null;
  const activityCount = Number(readStorage(ActivityKey)) || 0;
  const notificationCount = Number(readStorage(NotificationKey)) || 0;
  const lastError = (readStorage(LastErrorKey) as string | null) ?? undefined;
  const rpcLog = getRpcLogs(STELLAR_NETWORK.name);
  const lastBroadcastTx = getLastBroadcastTx();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: redact(settings) as Record<string, unknown>,
    activeProfileId: redact(activeProfileId) as string | null,
    activityCount,
    notificationCount,
    rpcLog: redact(rpcLog) as RpcLogEntry[],
    lastError: redact(lastError) as string | undefined,
    lastBroadcastTx: redact(lastBroadcastTx) as string | null,
  };
}

export function importDebugBundle(bundle: unknown): void {
  if (!bundle || typeof bundle !== 'object') {
    throw new Error('Invalid debug bundle');
  }
  const b = bundle as DebugBundle;
  if (b.version !== 1) {
    throw new Error('Unsupported debug bundle version');
  }
  if (b.settings && typeof b.settings === 'object') {
    localStorage.setItem(SettingsKey, JSON.stringify(b.settings));
  }
}
