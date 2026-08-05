import { useState, useMemo } from 'react';
import { useNotificationsStore, type NotificationEntry } from '@/stores/notificationsStore';

// ─── helpers ────────────────────────────────────────────────────────────────

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toDateInputValue(ms: number): string {
  // Produces "YYYY-MM-DD" in local time for <input type="date">
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dateInputToStartOfDay(value: string): number {
  // Parse "YYYY-MM-DD" as local midnight → epoch ms
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

function dateInputToEndOfDay(value: string): number {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

// ─── notification row ───────────────────────────────────────────────────────

function NotificationRow({
  n,
  onMarkRead,
  onMarkUnread,
  onRemove,
}: {
  n: NotificationEntry;
  onMarkRead: (id: string) => void;
  onMarkUnread: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div
      className={`flex flex-col gap-3 border p-4 transition-colors ${
        n.read
          ? 'border-outline-variant bg-surface-container'
          : 'border-outline-variant bg-surface-bright'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          {!n.read && <span className="h-2 w-2 flex-shrink-0 bg-tertiary" aria-label="unread" />}
          <span
            className={`font-heading text-sm font-bold uppercase tracking-wider ${
              n.read ? 'text-on-surface-variant' : 'text-on-surface'
            }`}
          >
            {n.title}
          </span>
        </div>
        <span className="flex-shrink-0 font-mono text-[10px] text-outline">
          {formatTs(n.timestamp)}
        </span>
      </div>

      <p className="font-body text-sm leading-relaxed text-on-surface-variant">{n.body}</p>

      {(n.amount || n.asset || n.sender) && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-outline-variant pt-2">
          {n.amount && (
            <span className="font-mono text-[10px] text-outline">
              <span className="uppercase tracking-widest">Amount </span>
              <span className="text-on-surface">{n.amount}</span>
            </span>
          )}
          {n.asset && (
            <span className="font-mono text-[10px] text-outline">
              <span className="uppercase tracking-widest">Asset </span>
              <span className="text-on-surface">{n.asset}</span>
            </span>
          )}
          {n.sender && (
            <span className="font-mono text-[10px] text-outline">
              <span className="uppercase tracking-widest">Sender </span>
              <span className="text-on-surface" title={n.sender}>
                {n.sender.length > 28
                  ? `${n.sender.slice(0, 10)}…${n.sender.slice(-10)}`
                  : n.sender}
              </span>
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        {n.read ? (
          <button
            onClick={() => onMarkUnread(n.id)}
            className="font-mono text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-on-surface-variant"
          >
            Mark unread
          </button>
        ) : (
          <button
            onClick={() => onMarkRead(n.id)}
            className="font-mono text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-on-surface-variant"
          >
            Mark read
          </button>
        )}
        <button
          onClick={() => onRemove(n.id)}
          className="font-mono text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-error"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// ─── page ───────────────────────────────────────────────────────────────────

export default function Notifications() {
  const { notifications, markRead, markUnread, markAllRead, removeNotification, clearAll, search } =
    useNotificationsStore();

  const [query, setQuery] = useState('');
  const [sinceDate, setSinceDate] = useState('');
  const [untilDate, setUntilDate] = useState('');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const filtered = useMemo(() => {
    const since = sinceDate ? dateInputToStartOfDay(sinceDate) : undefined;
    const until = untilDate ? dateInputToEndOfDay(untilDate) : undefined;
    const results = search({ query: query || undefined, since, until });
    if (showUnreadOnly) return results.filter((n) => !n.read);
    return results;
  }, [search, query, sinceDate, untilDate, showUnreadOnly, notifications]);

  const today = toDateInputValue(Date.now());

  return (
    <div className="flex flex-col gap-8">
      {/* ── heading ── */}
      <section className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Notification History
        </span>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
            Notifications
            {unreadCount > 0 && (
              <span className="ml-3 bg-tertiary px-2 py-0.5 font-mono text-xs font-normal text-surface">
                {unreadCount}
              </span>
            )}
          </h1>
          <div className="flex gap-3">
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead()}
                className="font-mono text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-on-surface-variant"
              >
                Mark all read
              </button>
            )}
            {notifications.length > 0 && (
              <button
                onClick={() => clearAll()}
                className="font-mono text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-error"
              >
                Clear all
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── search + filter ── */}
      <section className="flex flex-col gap-4 border border-outline-variant p-4">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Search &amp; Filter
        </span>

        {/* search input */}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search amount, asset, sender, message…"
          className="w-full border border-outline bg-surface px-3 py-2 font-mono text-sm text-on-surface placeholder-outline outline-none transition-colors focus:border-tertiary"
          aria-label="Search notifications"
        />

        {/* date range + unread filter */}
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              From
            </label>
            <input
              type="date"
              value={sinceDate}
              max={untilDate || today}
              onChange={(e) => setSinceDate(e.target.value)}
              className="border border-outline bg-surface px-3 py-2 font-mono text-sm text-on-surface outline-none transition-colors focus:border-tertiary"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
              To
            </label>
            <input
              type="date"
              value={untilDate}
              min={sinceDate || undefined}
              max={today}
              onChange={(e) => setUntilDate(e.target.value)}
              className="border border-outline bg-surface px-3 py-2 font-mono text-sm text-on-surface outline-none transition-colors focus:border-tertiary"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 pb-2 font-mono text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-on-surface-variant">
            <input
              type="checkbox"
              checked={showUnreadOnly}
              onChange={(e) => setShowUnreadOnly(e.target.checked)}
              className="h-4 w-4 accent-tertiary"
            />
            Unread only
          </label>

          {(query || sinceDate || untilDate || showUnreadOnly) && (
            <button
              onClick={() => {
                setQuery('');
                setSinceDate('');
                setUntilDate('');
                setShowUnreadOnly(false);
              }}
              className="pb-2 font-mono text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-on-surface-variant"
            >
              Reset
            </button>
          )}
        </div>
      </section>

      {/* ── results ── */}
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {notifications.length === 0 && (
          <p className="font-body text-sm text-on-surface-variant">
            No notifications yet. Stealth payment alerts from the service worker will appear here.
          </p>
        )}

        {notifications.length > 0 && filtered.length === 0 && (
          <p className="font-body text-sm text-on-surface-variant">
            No notifications match the current filters.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {filtered.map((n) => (
            <NotificationRow
              key={n.id}
              n={n}
              onMarkRead={markRead}
              onMarkUnread={markUnread}
              onRemove={removeNotification}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
