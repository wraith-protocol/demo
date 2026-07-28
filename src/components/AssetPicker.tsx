import { useState, useRef, useEffect, useMemo } from 'react';

export interface BalanceEntry {
  key: string;
  code: string;
  issuer?: string;
  balance: string;
  isKnown: boolean;
  isNative: boolean;
}

export interface AssetPickerProps {
  balances: BalanceEntry[];
  selectedKey: string;
  onSelect: (key: string) => void;
  trustlineWarning?: string;
  disabled?: boolean;
}

function formatBalanceDisplay(balance: string): string {
  const num = parseFloat(balance);
  if (!Number.isFinite(num)) return '0';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
  if (num >= 1) return num.toFixed(2);
  return num.toPrecision(3);
}

export function AssetPicker({
  balances,
  selectedKey,
  onSelect,
  trustlineWarning,
  disabled = false,
}: AssetPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(() => {
    const sorted = [...balances];
    sorted.sort((a, b) => {
      if (a.isNative) return -1;
      if (b.isNative) return 1;
      return parseFloat(b.balance) - parseFloat(a.balance);
    });
    return sorted;
  }, [balances]);

  const selectedEntry = entries.find((e) => e.key === selectedKey);
  const displayCode = selectedEntry?.code ?? selectedKey;

  const filtered = useMemo(() => {
    if (!search) return entries;
    const q = search.toLowerCase();
    return entries.filter(
      (e) => e.code.toLowerCase().includes(q) || (e.issuer && e.issuer.toLowerCase().includes(q)),
    );
  }, [entries, search]);

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="flex h-12 items-center gap-2 border border-outline-variant bg-surface-bright px-3 font-mono text-sm text-primary transition-colors hover:border-primary disabled:opacity-30"
      >
        <span className="font-heading text-xs font-semibold uppercase tracking-wider">
          {displayCode}
        </span>
        <svg
          className={`h-3 w-3 text-outline transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 10 6"
        >
          <path stroke="currentColor" strokeWidth="1.5" d="M1 1l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 border border-outline-variant bg-surface shadow-xl">
          <div className="border-b border-outline-variant/30 p-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search assets…"
              className="h-8 w-full border border-outline-variant bg-surface-bright px-2 font-mono text-xs text-primary placeholder:text-outline focus:border-primary"
              autoFocus
            />
          </div>

          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center font-mono text-xs text-outline">
                No assets found
              </div>
            ) : (
              filtered.map((entry) => {
                const isSelected = entry.key === selectedKey;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => {
                      onSelect(entry.key);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between px-3 py-2.5 text-left font-mono text-xs transition-colors hover:bg-surface-bright ${
                      isSelected ? 'bg-surface-bright' : ''
                    }`}
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="font-heading text-xs font-semibold text-primary">
                        {entry.code}
                      </span>
                      {entry.issuer && (
                        <span className="text-[9px] text-outline truncate max-w-[180px]">
                          {entry.issuer}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 text-on-surface-variant">
                      {formatBalanceDisplay(entry.balance)}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {trustlineWarning && (
            <div className="border-t border-outline-variant/30 bg-surface-container px-3 py-2">
              <p className="font-mono text-[10px] leading-relaxed text-error">{trustlineWarning}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
