/**
 * Benchmark: portfolio derivation functions on 500 synthetic ActivityEntry rows.
 *
 * Acceptance criterion from issue #148:
 *   filterByWindow + calcAssetTotals + calcMonthlyFlow + calcTopCounterparties
 *   must complete in under 100 ms for 500 entries per time-window switch.
 *
 * Run with:  node --loader ts-node/esm src/lib/portfolio.bench.ts
 * Or via:    pnpm test:unit (picked up as a vitest test file)
 */

import { describe, it, expect } from 'vitest';
import type { ActivityEntry } from '@/stores/activityStore';
import {
  filterByWindow,
  calcAssetTotals,
  calcMonthlyFlow,
  calcTopCounterparties,
  type TimeWindow,
} from './portfolio';

// ─── Synthetic data generator ─────────────────────────────────────────────────

const TOKENS = ['XLM', 'USDC', 'BTC', 'ETH', 'SOL'];
const DIRECTIONS = ['in', 'out'] as const;
const STATUSES = ['confirmed', 'pending', 'failed'] as const;
const RECIPIENTS = Array.from({ length: 20 }, (_, i) => `ADDR_${i.toString().padStart(3, '0')}`);

const NOW = Date.now();
const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

function generateEntries(count: number): ActivityEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `bench-tx-${i}`,
    chain: 'stellar',
    wallet: 'BENCH_WALLET',
    kind: 'stealth-send' as const,
    direction: DIRECTIONS[i % 2],
    status: STATUSES[i % 3],
    amount: String(((i % 500) + 1) * 0.5),
    token: TOKENS[i % TOKENS.length],
    recipient: RECIPIENTS[i % RECIPIENTS.length],
    timestamp: NOW - (i / count) * NINETY_DAYS, // spread evenly over 90 days
  }));
}

// ─── Benchmark test ───────────────────────────────────────────────────────────

describe('portfolio benchmark — 500 entries, <100ms requirement', () => {
  const ENTRY_COUNT = 500;
  const THRESHOLD_MS = 100;
  const entries = generateEntries(ENTRY_COUNT);
  const windows: TimeWindow[] = ['7d', '30d', '90d', 'all'];

  it(`runs all four derivation functions across all four windows in under ${THRESHOLD_MS}ms`, () => {
    // Warm up Intl formatters (jsdom initialises locale data lazily on first call)
    calcMonthlyFlow([]);

    const start = performance.now();

    for (const win of windows) {
      const filtered = filterByWindow(entries, win);
      calcAssetTotals(filtered);
      calcMonthlyFlow(filtered);
      calcTopCounterparties(filtered, 5);
    }

    const elapsed = performance.now() - start;

    console.log(`\n📊 Portfolio benchmark (${ENTRY_COUNT} entries × ${windows.length} windows)`);
    console.log(`   Total elapsed : ${elapsed.toFixed(3)} ms`);
    console.log(`   Per-window avg: ${(elapsed / windows.length).toFixed(3)} ms`);
    console.log(`   Threshold     : ${THRESHOLD_MS} ms`);
    console.log(`   Result        : ${elapsed < THRESHOLD_MS ? '✅ PASS' : '❌ FAIL'}`);

    expect(elapsed).toBeLessThan(THRESHOLD_MS);
  });

  it('runs a single time-window switch in under 50ms (hot-path latency)', () => {
    // Warm up Intl formatters and JIT
    calcMonthlyFlow([]);
    filterByWindow(entries, '30d');

    const start = performance.now();
    const filtered = filterByWindow(entries, '30d');
    calcAssetTotals(filtered);
    calcMonthlyFlow(filtered);
    calcTopCounterparties(filtered, 5);
    const elapsed = performance.now() - start;

    console.log(
      `\n⚡ Single window-switch (30d, ${filtered.length} filtered entries): ${elapsed.toFixed(3)} ms`,
    );

    expect(elapsed).toBeLessThan(50);
  });
});
