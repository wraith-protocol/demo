import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { ActivityEntry } from '@/stores/activityStore';
import {
  filterByWindow,
  calcAssetTotals,
  calcMonthlyFlow,
  calcTopCounterparties,
  type TimeWindow,
} from './portfolio';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0); // 2026-01-15T12:00:00Z — fixed reference

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function makeEntry(overrides: Partial<ActivityEntry>): ActivityEntry {
  return {
    id: 'tx-1',
    chain: 'stellar',
    wallet: 'WALLET',
    kind: 'stealth-send',
    direction: 'out',
    status: 'confirmed',
    amount: '10',
    token: 'XLM',
    recipient: 'ADDR_A',
    timestamp: NOW,
    ...overrides,
  };
}

// ─── filterByWindow ────────────────────────────────────────────────────────────

describe('filterByWindow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty array when given no entries', () => {
    expect(filterByWindow([], '7d')).toEqual([]);
    expect(filterByWindow([], '30d')).toEqual([]);
    expect(filterByWindow([], 'all')).toEqual([]);
  });

  it('returns all entries for the "all" window regardless of age', () => {
    const entries = [
      makeEntry({ id: 'a', timestamp: NOW - 365 * DAY }),
      makeEntry({ id: 'b', timestamp: NOW - 1 * DAY }),
      makeEntry({ id: 'c', timestamp: NOW }),
    ];
    expect(filterByWindow(entries, 'all')).toHaveLength(3);
  });

  it('includes entries exactly at the cutoff boundary (inclusive >=)', () => {
    const cutoff7d = NOW - 7 * DAY;
    const cutoff30d = NOW - 30 * DAY;
    const cutoff90d = NOW - 90 * DAY;

    const atCutoff7d = makeEntry({ id: '7d-boundary', timestamp: cutoff7d });
    const atCutoff30d = makeEntry({ id: '30d-boundary', timestamp: cutoff30d });
    const atCutoff90d = makeEntry({ id: '90d-boundary', timestamp: cutoff90d });

    expect(filterByWindow([atCutoff7d], '7d')).toHaveLength(1);
    expect(filterByWindow([atCutoff30d], '30d')).toHaveLength(1);
    expect(filterByWindow([atCutoff90d], '90d')).toHaveLength(1);
  });

  it('excludes entries 1ms before the cutoff', () => {
    const justBefore7d = makeEntry({ id: 'just-before', timestamp: NOW - 7 * DAY - 1 });
    expect(filterByWindow([justBefore7d], '7d')).toHaveLength(0);
  });

  it('filters correctly with a mixed set spanning multiple windows', () => {
    const entries = [
      makeEntry({ id: 'in-7d', timestamp: NOW - 3 * DAY }),
      makeEntry({ id: 'in-30d-not-7d', timestamp: NOW - 10 * DAY }),
      makeEntry({ id: 'in-90d-not-30d', timestamp: NOW - 45 * DAY }),
      makeEntry({ id: 'older', timestamp: NOW - 120 * DAY }),
    ];

    expect(filterByWindow(entries, '7d')).toHaveLength(1);
    expect(filterByWindow(entries, '30d')).toHaveLength(2);
    expect(filterByWindow(entries, '90d')).toHaveLength(3);
    expect(filterByWindow(entries, 'all')).toHaveLength(4);
  });

  it('does not mutate the original array', () => {
    const entries = [makeEntry({ id: 'old', timestamp: NOW - 200 * DAY })];
    const original = [...entries];
    filterByWindow(entries, '7d');
    expect(entries).toEqual(original);
  });
});

// ─── calcAssetTotals ──────────────────────────────────────────────────────────

describe('calcAssetTotals', () => {
  it('returns empty object for empty input', () => {
    expect(calcAssetTotals([])).toEqual({});
  });

  it('accumulates a single inflow entry', () => {
    const entry = makeEntry({ direction: 'in', amount: '50', token: 'XLM' });
    const result = calcAssetTotals([entry]);
    expect(result['XLM']).toEqual({ in: 50, out: 0, net: 50 });
  });

  it('accumulates a single outflow entry', () => {
    const entry = makeEntry({ direction: 'out', amount: '20', token: 'XLM' });
    const result = calcAssetTotals([entry]);
    expect(result['XLM']).toEqual({ in: 0, out: 20, net: -20 });
  });

  it('accumulates mixed inflow and outflow for the same token', () => {
    const entries = [
      makeEntry({ id: 'a', direction: 'in', amount: '100', token: 'XLM' }),
      makeEntry({ id: 'b', direction: 'out', amount: '30', token: 'XLM' }),
      makeEntry({ id: 'c', direction: 'in', amount: '20', token: 'XLM' }),
    ];
    const result = calcAssetTotals(entries);
    expect(result['XLM'].in).toBeCloseTo(120);
    expect(result['XLM'].out).toBeCloseTo(30);
    expect(result['XLM'].net).toBeCloseTo(90);
  });

  it('tracks multiple tokens independently', () => {
    const entries = [
      makeEntry({ id: 'a', direction: 'in', amount: '100', token: 'XLM' }),
      makeEntry({ id: 'b', direction: 'out', amount: '5', token: 'USDC' }),
      makeEntry({ id: 'c', direction: 'in', amount: '200', token: 'USDC' }),
    ];
    const result = calcAssetTotals(entries);
    expect(result['XLM']).toEqual({ in: 100, out: 0, net: 100 });
    expect(result['USDC'].in).toBeCloseTo(200);
    expect(result['USDC'].out).toBeCloseTo(5);
    expect(result['USDC'].net).toBeCloseTo(195);
  });

  it('falls back to "Unknown" when token is missing', () => {
    const entry = makeEntry({ direction: 'in', amount: '10', token: undefined });
    const result = calcAssetTotals([entry]);
    expect(result['Unknown']).toBeDefined();
    expect(result['Unknown'].in).toBeCloseTo(10);
  });

  it('treats missing or non-numeric amount as 0', () => {
    const entries = [
      makeEntry({ id: 'a', direction: 'in', amount: undefined, token: 'XLM' }),
      makeEntry({ id: 'b', direction: 'out', amount: 'NaN', token: 'XLM' }),
    ];
    const result = calcAssetTotals(entries);
    expect(result['XLM']).toEqual({ in: 0, out: 0, net: 0 });
  });
});

// ─── calcMonthlyFlow ──────────────────────────────────────────────────────────

describe('calcMonthlyFlow', () => {
  it('returns empty array for empty input', () => {
    expect(calcMonthlyFlow([])).toEqual([]);
  });

  it('returns a single bucket for entries in the same month', () => {
    const entries = [
      makeEntry({ id: 'a', direction: 'in', amount: '50', timestamp: Date.UTC(2026, 0, 5) }),
      makeEntry({ id: 'b', direction: 'out', amount: '20', timestamp: Date.UTC(2026, 0, 20) }),
    ];
    const result = calcMonthlyFlow(entries);
    expect(result).toHaveLength(1);
    expect(result[0].in).toBeCloseTo(50);
    expect(result[0].out).toBeCloseTo(20);
  });

  it('produces separate buckets for different months', () => {
    const entries = [
      makeEntry({ id: 'a', direction: 'in', amount: '10', timestamp: Date.UTC(2025, 10, 15) }),
      makeEntry({ id: 'b', direction: 'in', amount: '20', timestamp: Date.UTC(2025, 11, 15) }),
      makeEntry({ id: 'c', direction: 'out', amount: '5', timestamp: Date.UTC(2026, 0, 15) }),
    ];
    const result = calcMonthlyFlow(entries);
    expect(result).toHaveLength(3);
  });

  it('returns buckets sorted chronologically (oldest first)', () => {
    const entries = [
      makeEntry({ id: 'a', timestamp: Date.UTC(2026, 2, 1) }), // Mar
      makeEntry({ id: 'b', timestamp: Date.UTC(2025, 11, 1) }), // Dec
      makeEntry({ id: 'c', timestamp: Date.UTC(2026, 0, 1) }), // Jan
    ];
    const result = calcMonthlyFlow(entries);
    expect(result.map((r) => r.month)).toEqual(['Dec 25', 'Jan 26', 'Mar 26']);
  });

  it('accumulates inflow and outflow per bucket correctly', () => {
    const entries = [
      makeEntry({ id: 'a', direction: 'in', amount: '100', timestamp: Date.UTC(2026, 0, 1) }),
      makeEntry({ id: 'b', direction: 'in', amount: '50', timestamp: Date.UTC(2026, 0, 20) }),
      makeEntry({ id: 'c', direction: 'out', amount: '30', timestamp: Date.UTC(2026, 0, 25) }),
    ];
    const result = calcMonthlyFlow(entries);
    expect(result).toHaveLength(1);
    expect(result[0].in).toBeCloseTo(150);
    expect(result[0].out).toBeCloseTo(30);
  });

  it('handles entries at month boundaries (mid-month, unambiguous)', () => {
    // Use mid-month timestamps so local-timezone offset cannot shift the month
    const midJan = Date.UTC(2026, 0, 15, 12, 0, 0, 0);
    const midFeb = Date.UTC(2026, 1, 15, 12, 0, 0, 0);
    const entries = [
      makeEntry({ id: 'a', direction: 'in', amount: '10', timestamp: midJan }),
      makeEntry({ id: 'b', direction: 'in', amount: '20', timestamp: midFeb }),
    ];
    const result = calcMonthlyFlow(entries);
    expect(result).toHaveLength(2);
    // Jan bucket should have 10, Feb bucket should have 20
    const totalIn = result.reduce((sum, r) => sum + r.in, 0);
    expect(totalIn).toBeCloseTo(30);
    // Sorted chronologically: Jan before Feb
    expect(result[0].in).toBeCloseTo(10);
    expect(result[1].in).toBeCloseTo(20);
  });
});

// ─── calcTopCounterparties ────────────────────────────────────────────────────

describe('calcTopCounterparties', () => {
  it('returns empty array for empty input', () => {
    expect(calcTopCounterparties([])).toEqual([]);
  });

  it('skips entries with no recipient', () => {
    const entries = [makeEntry({ recipient: undefined })];
    expect(calcTopCounterparties(entries)).toEqual([]);
  });

  it('aggregates counts and totals for a single counterparty', () => {
    const entries = [
      makeEntry({ id: 'a', recipient: 'ADDR_A', amount: '10' }),
      makeEntry({ id: 'b', recipient: 'ADDR_A', amount: '40' }),
    ];
    const result = calcTopCounterparties(entries);
    expect(result).toHaveLength(1);
    expect(result[0].address).toBe('ADDR_A');
    expect(result[0].count).toBe(2);
    expect(result[0].total).toBeCloseTo(50);
  });

  it('ranks counterparties by total descending', () => {
    const entries = [
      makeEntry({ id: 'a', recipient: 'LOW', amount: '5' }),
      makeEntry({ id: 'b', recipient: 'HIGH', amount: '200' }),
      makeEntry({ id: 'c', recipient: 'MID', amount: '50' }),
    ];
    const result = calcTopCounterparties(entries);
    expect(result[0].address).toBe('HIGH');
    expect(result[1].address).toBe('MID');
    expect(result[2].address).toBe('LOW');
  });

  it('respects the limit parameter (default 5)', () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry({ id: `tx-${i}`, recipient: `ADDR_${i}`, amount: String(i + 1) }),
    );
    expect(calcTopCounterparties(entries)).toHaveLength(5);
    expect(calcTopCounterparties(entries, 3)).toHaveLength(3);
    expect(calcTopCounterparties(entries, 10)).toHaveLength(10);
  });

  it('attaches labels from the labels map when provided', () => {
    const entries = [makeEntry({ recipient: 'ADDR_A', amount: '10' })];
    const labels = { ADDR_A: 'Alice' };
    const result = calcTopCounterparties(entries, 5, labels);
    expect(result[0].label).toBe('Alice');
  });

  it('leaves label undefined when address is not in labels map', () => {
    const entries = [makeEntry({ recipient: 'ADDR_B', amount: '10' })];
    const labels = { ADDR_A: 'Alice' };
    const result = calcTopCounterparties(entries, 5, labels);
    expect(result[0].label).toBeUndefined();
  });

  it('uses count as tiebreaker when totals are equal', () => {
    const entries = [
      makeEntry({ id: 'a', recipient: 'ONCE', amount: '100' }),
      makeEntry({ id: 'b', recipient: 'TWICE', amount: '50' }),
      makeEntry({ id: 'c', recipient: 'TWICE', amount: '50' }),
    ];
    const result = calcTopCounterparties(entries);
    // Both ONCE and TWICE total 100; TWICE has 2 txs so it ranks first
    expect(result[0].address).toBe('TWICE');
    expect(result[1].address).toBe('ONCE');
  });

  it('handles a mixed entry set with missing amounts', () => {
    const entries = [
      makeEntry({ id: 'a', recipient: 'ADDR_A', amount: undefined }),
      makeEntry({ id: 'b', recipient: 'ADDR_A', amount: '20' }),
    ];
    const result = calcTopCounterparties(entries);
    expect(result[0].total).toBeCloseTo(20);
    expect(result[0].count).toBe(2);
  });
});
