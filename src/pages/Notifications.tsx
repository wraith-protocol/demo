import { useState } from 'react';
import { useUndoStore } from '@/stores/undoStore';

interface Notification {
  id: string;
  title: string;
  body: string;
  read: boolean;
}

const INITIAL_NOTIFICATIONS: Notification[] = [
  { id: '1', title: 'Payment received', body: 'You received 10 XLM from Alice.', read: false },
  { id: '2', title: 'Contact added', body: 'Bob was added to your contacts.', read: false },
  { id: '3', title: 'Schedule executed', body: 'Recurring payment to Carol completed.', read: true },
];

export default function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>(INITIAL_NOTIFICATIONS);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const addToast = useUndoStore((s) => s.addToast);

  const dismiss = (notification: Notification) => {
    const previous = [...notifications];
    setNotifications((n) => n.filter((x) => x.id !== notification.id));
    addToast(`Dismissed "${notification.title}"`, () => {
      setNotifications(previous);
    });
  };

  const clearFilter = () => {
    const previousFilter = filter;
    setFilter('all');
    addToast('Filter cleared', () => {
      setFilter(previousFilter);
    });
  };

  const filtered = filter === 'unread'
    ? notifications.filter((n) => !n.read)
    : notifications;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Notifications
        </h1>
        <div className="flex items-center gap-3">
          <div className="flex gap-2">
            {(['all', 'unread'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`font-body text-sm px-3 py-1 rounded-lg capitalize ${
                  filter === f
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-variant text-on-surface-variant'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          {filter !== 'all' && (
            <button
              onClick={clearFilter}
              className="font-body text-sm text-on-surface-variant hover:underline"
            >
              Clear filter
            </button>
          )}
        </div>
      </section>
      <ul className="flex flex-col gap-3">
        {filtered.length === 0 && (
          <p className="font-body text-sm text-on-surface-variant">No notifications.</p>
        )}
        {filtered.map((n) => (
          <li
            key={n.id}
            className="flex items-start justify-between rounded-xl bg-surface-variant px-4 py-3"
          >
            <div className="flex flex-col gap-1">
              <span className={`font-body text-sm font-semibold ${n.read ? 'text-on-surface-variant' : 'text-on-surface'}`}>
                {n.title}
              </span>
              <span className="font-body text-xs text-on-surface-variant">{n.body}</span>
            </div>
            <button
              onClick={() => dismiss(n)}
              className="font-body text-sm text-on-surface-variant hover:underline ml-4 shrink-0"
            >
              Dismiss
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
