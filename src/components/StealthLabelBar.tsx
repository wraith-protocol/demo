import { useRef } from 'react';
import type { StealthLabel } from '@/lib/stealth-labels';

interface StealthLabelBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  activeTag: string | null;
  allTags: string[];
  onTagSelect: (tag: string | null) => void;
  showHidden: boolean;
  onToggleShowHidden: () => void;
  showPrivacyWarning: boolean;
  onDismissPrivacyWarning: () => void;
  onExport: () => StealthLabel[];
  onImport: (labels: StealthLabel[], overwrite: boolean) => { merged: number; added: number };
}

export function StealthLabelBar({
  searchQuery,
  onSearchChange,
  activeTag,
  allTags,
  onTagSelect,
  showHidden,
  onToggleShowHidden,
  showPrivacyWarning,
  onDismissPrivacyWarning,
  onExport,
  onImport,
}: StealthLabelBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const data = onExport();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wraith-labels-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text) as StealthLabel[];
      if (!Array.isArray(imported)) throw new Error('Invalid format');
      const overwrite = window.confirm(
        'Some labels may already exist. Click OK to overwrite existing, Cancel to keep existing ones.',
      );
      const result = onImport(imported, overwrite);
      alert(`Imported ${result.added} new, merged ${result.merged} labels.`);
    } catch {
      alert('Failed to import labels. Check file format.');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="flex flex-col gap-3">
      {showPrivacyWarning && (
        <div className="border border-tertiary/30 bg-tertiary/5 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="font-body text-[11px] leading-relaxed text-on-surface-variant">
              Labels are stored only in this browser. Clear browser data = lose labels. Wraith never sees them.
            </p>
            <button
              onClick={onDismissPrivacyWarning}
              className="shrink-0 font-mono text-[9px] uppercase tracking-widest text-tertiary transition-colors hover:text-primary"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <svg
            className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-outline"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" strokeLinecap="square" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search labels, tags, or addresses..."
            className="h-9 w-full border border-outline-variant bg-surface pl-8 pr-3 font-mono text-[11px] text-primary placeholder:text-outline focus:border-primary"
          />
        </div>

        <button
          onClick={handleExport}
          className="h-9 border border-outline-variant px-3 font-mono text-[9px] uppercase tracking-widest text-outline transition-colors hover:bg-surface-bright hover:text-primary"
        >
          Export
        </button>
        <button
          onClick={handleImport}
          className="h-9 border border-outline-variant px-3 font-mono text-[9px] uppercase tracking-widest text-outline transition-colors hover:bg-surface-bright hover:text-primary"
        >
          Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />

        <button
          onClick={onToggleShowHidden}
          className={`h-9 border px-3 font-mono text-[9px] uppercase tracking-widest transition-colors ${
            showHidden
              ? 'border-outline-variant bg-surface-bright text-primary'
              : 'border-outline-variant text-outline hover:bg-surface-bright hover:text-primary'
          }`}
        >
          Hidden
        </button>
      </div>

      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {activeTag && (
            <button
              onClick={() => onTagSelect(null)}
              className="px-1.5 font-mono text-[9px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
            >
              All
            </button>
          )}
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => onTagSelect(activeTag === tag ? null : tag)}
              className={`rounded-none border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors ${
                activeTag === tag
                  ? 'border-tertiary bg-tertiary/10 text-tertiary'
                  : 'border-outline-variant text-outline hover:border-primary hover:text-primary'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {searchQuery && (
        <p className="font-mono text-[9px] text-on-surface-variant">
          Filtering by: <span className="text-primary">&ldquo;{searchQuery}&rdquo;</span>
        </p>
      )}
    </div>
  );
}
