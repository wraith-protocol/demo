import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/EmptyState';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { useActivityStore } from '@/stores/activityStore';
import {
  filterByWindow,
  calcAssetTotals,
  calcMonthlyFlow,
  calcTopCounterparties,
  type TimeWindow,
} from '@/lib/portfolio';

// ─── Inline SVG Bar Chart ─────────────────────────────────────────────────────

interface BarChartProps {
  data: { month: string; in: number; out: number }[];
}

function MonthlyBarChart({ data }: BarChartProps) {
  const WIDTH = 600;
  const HEIGHT = 160;
  const PADDING = { top: 12, right: 8, bottom: 32, left: 44 };

  const chartW = WIDTH - PADDING.left - PADDING.right;
  const chartH = HEIGHT - PADDING.top - PADDING.bottom;

  const maxVal = Math.max(...data.flatMap((d) => [d.in, d.out]), 1);

  const groupCount = data.length;
  const groupWidth = groupCount > 0 ? chartW / groupCount : chartW;
  const barWidth = Math.max(4, (groupWidth - 6) / 2);

  // Y-axis tick count
  const tickCount = 4;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) =>
    Math.round((maxVal / tickCount) * i),
  );

  function fmt(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(Math.round(n));
  }

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full"
      role="img"
      aria-label="Monthly inflow and outflow bar chart"
    >
      {/* Y-axis gridlines + labels */}
      {ticks.map((tick) => {
        const y = PADDING.top + chartH - (tick / maxVal) * chartH;
        return (
          <g key={tick}>
            <line
              x1={PADDING.left}
              x2={PADDING.left + chartW}
              y1={y}
              y2={y}
              className="stroke-outline-variant"
              strokeWidth={0.5}
              strokeDasharray="3 3"
            />
            <text
              x={PADDING.left - 4}
              y={y + 4}
              textAnchor="end"
              className="fill-outline font-mono text-[9px]"
              fontSize={9}
            >
              {fmt(tick)}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {data.map((d, i) => {
        const gx = PADDING.left + i * groupWidth + (groupWidth - barWidth * 2 - 2) / 2;

        const inH = Math.max(1, (d.in / maxVal) * chartH);
        const outH = Math.max(1, (d.out / maxVal) * chartH);

        const inY = PADDING.top + chartH - inH;
        const outY = PADDING.top + chartH - outH;

        const labelY = HEIGHT - PADDING.bottom + 14;

        return (
          <g key={d.month}>
            {/* Inflow bar (green) */}
            <rect
              x={gx}
              y={inY}
              width={barWidth}
              height={inH}
              className="fill-[#4ade80] dark:fill-[#22c55e]"
              rx={1}
            >
              <title>
                {d.month} inflow: {fmt(d.in)}
              </title>
            </rect>

            {/* Outflow bar (red) */}
            <rect
              x={gx + barWidth + 2}
              y={outY}
              width={barWidth}
              height={outH}
              className="fill-[#f87171] dark:fill-[#ef4444]"
              rx={1}
            >
              <title>
                {d.month} outflow: {fmt(d.out)}
              </title>
            </rect>

            {/* Month label */}
            <text
              x={gx + barWidth + 1}
              y={labelY}
              textAnchor="middle"
              className="fill-outline font-mono"
              fontSize={8}
            >
              {d.month}
            </text>
          </g>
        );
      })}

      {/* X axis baseline */}
      <line
        x1={PADDING.left}
        x2={PADDING.left + chartW}
        y1={PADDING.top + chartH}
        y2={PADDING.top + chartH}
        className="stroke-outline-variant"
        strokeWidth={1}
      />
    </svg>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function ChartLegend() {
  return (
    <div className="flex items-center gap-4">
      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#4ade80] dark:bg-[#22c55e]" />
        Inflow
      </span>
      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#f87171] dark:bg-[#ef4444]" />
        Outflow
      </span>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (!isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}k`;
  return n.toFixed(n % 1 === 0 ? 0 : 4);
}

function shortAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TIME_WINDOWS: { value: TimeWindow; label: string }[] = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'all', label: 'All' },
];

export default function Portfolio() {
  const { t } = useTranslation();
  const { address } = useStellarWallet();
  const { entries } = useActivityStore();

  const [window, setWindow] = useState<TimeWindow>('30d');

  // Wallet-scoped entries only
  const walletEntries = useMemo(() => {
    if (!address) return [];
    return entries.filter((e) => e.wallet === address);
  }, [entries, address]);

  // Time-filtered entries — all derived data flows from this
  const windowEntries = useMemo(
    () => filterByWindow(walletEntries, window),
    [walletEntries, window],
  );

  const assetTotals = useMemo(() => calcAssetTotals(windowEntries), [windowEntries]);
  const monthlyFlow = useMemo(() => calcMonthlyFlow(windowEntries), [windowEntries]);
  const topCounterparties = useMemo(() => calcTopCounterparties(windowEntries, 5), [windowEntries]);

  const assetRows = useMemo(
    () => Object.entries(assetTotals).sort((a, b) => Math.abs(b[1].net) - Math.abs(a[1].net)),
    [assetTotals],
  );

  const hasData = windowEntries.length > 0;

  // ── Not connected ────────────────────────────────────────────────────────────
  if (!address) {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          {t('nav.portfolio')}
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Connect your wallet to view your portfolio analytics.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-8">
      {/* ── Page header ────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Analytics
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          {t('nav.portfolio')}
        </h1>
      </div>

      {/* ── Time filter tabs ────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Time window"
        className="flex gap-0 border border-outline-variant"
      >
        {TIME_WINDOWS.map(({ value, label }) => (
          <button
            key={value}
            role="tab"
            aria-selected={window === value}
            onClick={() => setWindow(value)}
            className={`flex-1 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors ${
              window === value
                ? 'bg-surface-container text-on-surface'
                : 'bg-surface text-outline hover:text-on-surface-variant'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {!hasData && (
        <EmptyState
          title="No activity in this window"
          description="There are no transactions in the selected time range. Try a wider window or make some transactions first."
          illustration={
            <svg
              className="h-10 w-10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18" />
              <path d="M9 21V9" />
            </svg>
          }
        />
      )}

      {hasData && (
        <>
          {/* ── Assets card ─────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Asset Totals
            </span>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[360px] border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant">
                    <th className="pb-2 text-left font-mono text-[10px] uppercase tracking-widest text-outline">
                      Asset
                    </th>
                    <th className="pb-2 text-right font-mono text-[10px] uppercase tracking-widest text-outline">
                      Inflow
                    </th>
                    <th className="pb-2 text-right font-mono text-[10px] uppercase tracking-widest text-outline">
                      Outflow
                    </th>
                    <th className="pb-2 text-right font-mono text-[10px] uppercase tracking-widest text-outline">
                      Net
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {assetRows.map(([token, totals]) => (
                    <tr key={token} className="border-b border-outline-variant/40 last:border-0">
                      <td className="py-2 font-mono text-xs font-medium text-on-surface">
                        {token}
                      </td>
                      <td className="py-2 text-right font-mono text-xs text-[#4ade80] dark:text-[#22c55e]">
                        +{fmt(totals.in)}
                      </td>
                      <td className="py-2 text-right font-mono text-xs text-[#f87171] dark:text-[#ef4444]">
                        -{fmt(totals.out)}
                      </td>
                      <td
                        className={`py-2 text-right font-mono text-xs ${
                          totals.net >= 0
                            ? 'text-[#4ade80] dark:text-[#22c55e]'
                            : 'text-[#f87171] dark:text-[#ef4444]'
                        }`}
                      >
                        {totals.net >= 0 ? '+' : ''}
                        {fmt(totals.net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Monthly bar chart ───────────────────────────────────────────── */}
          <div className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Monthly Flow
              </span>
              <ChartLegend />
            </div>

            {monthlyFlow.length === 0 ? (
              <p className="font-body text-xs text-on-surface-variant">
                Not enough data to display monthly flow.
              </p>
            ) : (
              <MonthlyBarChart data={monthlyFlow} />
            )}
          </div>

          {/* ── Top counterparties ──────────────────────────────────────────── */}
          <div className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
              Top Counterparties
            </span>

            {topCounterparties.length === 0 ? (
              <p className="font-body text-xs text-on-surface-variant">
                No counterparty data available.
              </p>
            ) : (
              <ul className="flex flex-col gap-0 divide-y divide-outline-variant/40">
                {topCounterparties.map((cp) => (
                  <li key={cp.address} className="flex items-center justify-between py-2.5">
                    <div className="flex flex-col gap-0.5">
                      {cp.label && (
                        <span className="font-body text-xs font-medium text-on-surface">
                          {cp.label}
                        </span>
                      )}
                      <span
                        className={`font-mono text-xs ${cp.label ? 'text-outline' : 'text-on-surface'}`}
                        title={cp.address}
                      >
                        {shortAddress(cp.address)}
                      </span>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="font-mono text-xs text-on-surface">{fmt(cp.total)}</span>
                      <span className="font-mono text-[10px] text-outline">
                        {cp.count} {cp.count === 1 ? 'tx' : 'txs'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
