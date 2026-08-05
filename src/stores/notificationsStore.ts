import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface NotificationEntry {
  id: string;
  title: string;
  body: string;
  /** epoch ms */
  timestamp: number;
  read: boolean;
  /** amount string e.g. "12.5" */
  amount?: string;
  /** asset/token ticker e.g. "XLM" */
  asset?: string;
  /** stealth address or sender hint */
  sender?: string;
  /** arbitrary extra data from the SW push payload */
  data?: Record<string, unknown>;
}

interface NotificationsState {
  notifications: NotificationEntry[];
  addNotification: (n: Omit<NotificationEntry, 'read'>) => void;
  markRead: (id: string) => void;
  markUnread: (id: string) => void;
  markAllRead: () => void;
  removeNotification: (id: string) => void;
  clearAll: () => void;
  /** Derived: number of unread notifications */
  unreadCount: () => number;
  /**
   * Search across title, body, amount, asset, and sender fields.
   * Optionally filter by `since` (epoch ms) and `until` (epoch ms).
   */
  search: (opts: { query?: string; since?: number; until?: number }) => NotificationEntry[];
}

export const useNotificationsStore = create<NotificationsState>()(
  persist(
    (set, get) => ({
      notifications: [],

      addNotification: (n) =>
        set((state) => {
          // Deduplicate by id
          if (state.notifications.find((x) => x.id === n.id)) return state;
          return {
            notifications: [{ ...n, read: false }, ...state.notifications],
          };
        }),

      markRead: (id) =>
        set((state) => ({
          notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        })),

      markUnread: (id) =>
        set((state) => ({
          notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: false } : n)),
        })),

      markAllRead: () =>
        set((state) => ({
          notifications: state.notifications.map((n) => ({ ...n, read: true })),
        })),

      removeNotification: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        })),

      clearAll: () => set({ notifications: [] }),

      unreadCount: () => get().notifications.filter((n) => !n.read).length,

      search: ({ query, since, until }) => {
        const { notifications } = get();
        const q = query?.toLowerCase().trim();

        return notifications.filter((n) => {
          if (since !== undefined && n.timestamp < since) return false;
          if (until !== undefined && n.timestamp > until) return false;

          if (!q) return true;

          return (
            n.title.toLowerCase().includes(q) ||
            n.body.toLowerCase().includes(q) ||
            (n.amount !== undefined && n.amount.toLowerCase().includes(q)) ||
            (n.asset !== undefined && n.asset.toLowerCase().includes(q)) ||
            (n.sender !== undefined && n.sender.toLowerCase().includes(q))
          );
        });
      },
    }),
    {
      name: 'wraith-notifications-storage',
    },
  ),
);
