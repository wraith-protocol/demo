import { STELLAR_NETWORK } from '@/config';

export interface RpcLogEntry {
  method: string;
  url: string;
  urlHost: string;
  duration: number;
  status: number;
  timestamp: number;
}

const MAX_LOGS = 100;
const STORAGE_KEY = 'wraith-rpc-log-enabled';
const logs = new Map<string, RpcLogEntry[]>();

let enabled = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'true';
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function isRpcLogEnabled() {
  return enabled;
}

export function setRpcLogEnabled(next: boolean) {
  if (enabled === next) return;
  enabled = next;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, String(next));
  }
  if (!enabled) {
    logs.clear();
  }
  notify();
}

export function getRpcLogs(chain: string) {
  return logs.get(chain) ?? [];
}

export function clearRpcLogs(chain: string) {
  if (chain) {
    logs.delete(chain);
  } else {
    logs.clear();
  }
  notify();
}

export function subscribeRpcLogs(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recordRpcCall(chain: string, entry: Omit<RpcLogEntry, 'timestamp'>) {
  if (!enabled) return;
  const list = logs.get(chain) ?? [];
  list.push({ ...entry, timestamp: Date.now() });
  if (list.length > MAX_LOGS) list.shift();
  logs.set(chain, list);
  notify();
}

let lastBroadcastTx: string | null = null;

export function recordBroadcastTx(xdr: string) {
  lastBroadcastTx = xdr;
}

export function getLastBroadcastTx() {
  return lastBroadcastTx;
}

if (typeof window !== 'undefined' && !(window as any).__rpcLogInstalled) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const start = performance.now();
    try {
      const response = await originalFetch(input, init);
      if (enabled) {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        const host = new URL(url).host;
        if (url.startsWith(STELLAR_NETWORK.rpcUrl) || url.startsWith(STELLAR_NETWORK.horizon)) {
          recordRpcCall(STELLAR_NETWORK.name, {
            method,
            url,
            urlHost: host,
            duration: performance.now() - start,
            status: response.status,
          });
        }
      }
      return response;
    } catch (e) {
      throw e;
    }
  };
  (window as any).__rpcLogInstalled = true;
}
