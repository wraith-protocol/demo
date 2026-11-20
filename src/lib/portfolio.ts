import type { ActivityEntry } from '@/stores/activityStore';

export type TimeWindow = '7d' | '30d' | '90d' | 'all';

export interface AssetTotals {
  [token: string]: { in: number; out: number; net: number };
}

export interface MonthlyFlow {
  month: string; // e.g. "Jan 25"
  in: number;
  out: number;
}

export interface Counterparty {
  address: string;
  label?: string;
  count: number;
  total: number;
}

const WINDOW_MS: Record<TimeWindow, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  all: Infinity,
};

/** Filter entries to those within the given time window relative to now. */
export function filterByWindow(entries: ActivityEntry[], window: TimeWindow): ActivityEntry[] {
  if (window === 'all') return entries;
  const cutoff = Date.now() - WINDOW_MS[window];
  return entries.filter((e) => e.timestamp >= cutoff);
}

/** Accumulate per-token inflow/outflow/net totals. */
export function calcAssetTotals(entries: ActivityEntry[]): AssetTotals {
  const totals: AssetTotals = {};

  for (const entry of entries) {
    const token = entry.token ?? 'Unknown';
    const amount = parseFloat(entry.amount ?? '0') || 0;

    if (!totals[token]) {
      totals[token] = { in: 0, out: 0, net: 0 };
    }

    if (entry.direction === 'in') {
      totals[token].in += amount;
    } else {
      totals[token].out += amount;
    }
    totals[token].net = totals[token].in - totals[token].out;
  }

  return totals;
}

// Module-level formatter — constructed once, reused across all calls.
const _monthFmt = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' });

/** Build a sorted array of monthly inflow/outflow buckets for a bar chart. */
export function calcMonthlyFlow(entries: ActivityEntry[]): MonthlyFlow[] {
  const buckets = new Map<string, { in: number; out: number; sortKey: string }>();

  for (const entry of entries) {
    const d = new Date(entry.timestamp);
    // e.g. "Jan 25"
    const month = _monthFmt.format(d);
    // ISO sort key: "2025-01"
    const sortKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const amount = parseFloat(entry.amount ?? '0') || 0;

    if (!buckets.has(month)) {
      buckets.set(month, { in: 0, out: 0, sortKey });
    }

    const bucket = buckets.get(month)!;
    if (entry.direction === 'in') {
      bucket.in += amount;
    } else {
      bucket.out += amount;
    }
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[1].sortKey.localeCompare(b[1].sortKey))
    .map(([month, data]) => ({ month, in: data.in, out: data.out }));
}

/**
 * Rank counterparties by total volume.
 * "recipient" field on outbound entries, "wallet" on inbound entries
 * (inbound entries arrive at our stealth address, so the counterparty is the sender
 * which we don't have — fall back to recipient field when present).
 */
export function calcTopCounterparties(
  entries: ActivityEntry[],
  limit = 5,
  labels?: Record<string, string>,
): Counterparty[] {
  const map = new Map<string, { count: number; total: number }>();

  for (const entry of entries) {
    const addr = entry.recipient;
    if (!addr) continue;

    const amount = parseFloat(entry.amount ?? '0') || 0;
    const existing = map.get(addr);
    if (existing) {
      existing.count += 1;
      existing.total += amount;
    } else {
      map.set(addr, { count: 1, total: amount });
    }
  }

  return Array.from(map.entries())
    .map(([address, data]) => ({
      address,
      label: labels?.[address],
      count: data.count,
      total: data.total,
    }))
    .sort((a, b) => b.total - a.total || b.count - a.count)
    .slice(0, limit);
}
