import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { faqEntries, categoryLabels, FAQEntry, FAQCategory } from '@/help/faq';

interface HelpOverlayProps {
  onClose: () => void;
}

export function HelpOverlay({ onClose }: HelpOverlayProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const location = useLocation();

  // Focus trap and initial focus
  useEffect(() => {
    searchInputRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Determine context based on current route
  const currentContext =
    location.pathname === '/send'
      ? 'send'
      : location.pathname === '/receive'
        ? 'receive'
        : 'general';

  // Filter and sort FAQ entries
  const filteredEntries = faqEntries
    .filter((entry) => {
      const matchesSearch =
        entry.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
        entry.answer.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesSearch;
    })
    .sort((a, b) => {
      // Prioritize entries matching current context
      const aMatchesContext = a.context.includes(currentContext as any);
      const bMatchesContext = b.context.includes(currentContext as any);

      if (aMatchesContext && !bMatchesContext) return -1;
      if (!aMatchesContext && bMatchesContext) return 1;

      // Then sort by category
      const categoryOrder: FAQCategory[] = [
        'getting-started',
        'stellar-specifics',
        'privacy',
        'troubleshooting',
      ];
      return categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
    });

  // Group entries by category
  const groupedEntries = filteredEntries.reduce(
    (acc, entry) => {
      if (!acc[entry.category]) {
        acc[entry.category] = [];
      }
      acc[entry.category].push(entry);
      return acc;
    },
    {} as Record<FAQCategory, FAQEntry[]>,
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
    >
      <div
        ref={overlayRef}
        className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-lg bg-surface shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-outline-variant px-6 py-4">
          <h2 id="help-title" className="font-heading text-lg font-bold text-on-surface">
            Help & FAQ
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded text-outline transition-colors hover:text-on-surface-variant hover:bg-surface-bright focus:outline-none focus:ring-2 focus:ring-tertiary"
            aria-label="Close help"
            type="button"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-outline-variant px-6 py-4">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-outline"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search FAQs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-outline-variant bg-surface-bright py-2.5 pl-10 pr-4 text-sm text-on-surface placeholder:text-outline focus:border-tertiary focus:outline-none focus:ring-1 focus:ring-tertiary"
              aria-label="Search FAQs"
            />
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto px-6 py-4">
          {Object.keys(groupedEntries).length === 0 ? (
            <p className="py-8 text-center text-outline">No FAQs found matching your search.</p>
          ) : (
            Object.entries(groupedEntries).map(([category, entries]) => (
              <div key={category} className="mb-6">
                <h3 className="mb-3 font-heading text-sm font-bold uppercase tracking-wider text-tertiary">
                  {categoryLabels[category as FAQCategory]}
                </h3>
                <div className="space-y-2">
                  {entries.map((entry) => (
                    <FAQItem
                      key={entry.id}
                      entry={entry}
                      isExpanded={expandedEntry === entry.id}
                      onToggle={() =>
                        setExpandedEntry(expandedEntry === entry.id ? null : entry.id)
                      }
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-outline-variant px-6 py-3">
          <p className="text-xs text-outline">
            Press{' '}
            <kbd className="mx-1 rounded border border-outline-variant px-1.5 py-0.5 font-mono text-[10px]">
              Esc
            </kbd>{' '}
            to close
          </p>
        </div>
      </div>
    </div>
  );
}

interface FAQItemProps {
  entry: FAQEntry;
  isExpanded: boolean;
  onToggle: () => void;
}

function FAQItem({ entry, isExpanded, onToggle }: FAQItemProps) {
  return (
    <div className="rounded-md border border-outline-variant bg-surface-bright">
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-3 text-left focus:outline-none focus:ring-2 focus:ring-tertiary focus:ring-inset"
        aria-expanded={isExpanded}
        aria-controls={`faq-answer-${entry.id}`}
        type="button"
      >
        <svg
          className={`mt-0.5 h-5 w-5 flex-shrink-0 text-outline transition-transform ${
            isExpanded ? 'rotate-90' : ''
          }`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        <span className="font-medium text-sm text-on-surface">{entry.question}</span>
      </button>

      {isExpanded && (
        <div id={`faq-answer-${entry.id}`} className="px-4 pb-4 pl-12">
          <p className="mb-3 text-sm leading-relaxed text-on-surface-variant">{entry.answer}</p>
          {entry.docsLink && (
            <a
              href={entry.docsLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-tertiary hover:text-tertiary/80"
            >
              Learn more
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <path d="M15 3h6v6" />
                <path d="M10 14L21 3" />
              </svg>
            </a>
          )}
        </div>
      )}
    </div>
  );
}
