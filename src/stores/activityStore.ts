import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { STELLAR_NETWORK } from '@/config';
import { DEFAULT_PROFILE_ID } from '@/store/profilesStore';

export type ActivityKind = 'stealth-send' | 'stealth-receive' | 'withdrawal' | 'name-registration';
export type ActivityStatus = 'pending' | 'confirmed' | 'failed';
export type ActivityDirection = 'in' | 'out';

export interface ActivityEntry {
  id: string; // usually tx hash
  chain: string; // e.g., 'stellar'
  wallet: string; // the connected wallet address
  kind: ActivityKind;
  direction: ActivityDirection;
  status: ActivityStatus;
  /** Profile that created this entry. Defaults to 'default' for legacy entries. */
  profileId: string;
  amount?: string;
  token?: string;
  recipient?: string;
  metadata?: any;
  timestamp: number;
}

interface ActivityState {
  entries: ActivityEntry[];
  addEntry: (entry: ActivityEntry) => void;
  updateStatus: (id: string, status: ActivityStatus) => void;
  clearHistory: (chain: string, wallet: string, profileId?: string) => void;
  pollPending: () => Promise<void>;
}

export const useActivityStore = create<ActivityState>()(
  persist(
    (set, get) => ({
      entries: [],
      addEntry: (entry) =>
        set((state) => {
          // Prevent duplicates by id
          const existing = state.entries.find((e) => e.id === entry.id);
          if (existing) return state;
          // Ensure profileId always has a value
          const safeEntry: ActivityEntry = {
            ...entry,
            profileId: entry.profileId || DEFAULT_PROFILE_ID,
          };
          return { entries: [safeEntry, ...state.entries] };
        }),
      updateStatus: (id, status) =>
        set((state) => ({
          entries: state.entries.map((e) => (e.id === id ? { ...e, status } : e)),
        })),
      clearHistory: (chain, wallet, profileId) =>
        set((state) => ({
          entries: state.entries.filter((e) => {
            // Always match chain + wallet
            if (e.chain !== chain || e.wallet !== wallet) return true;
            // If profileId provided, only clear that profile's entries
            if (profileId) return e.profileId !== profileId;
            return false;
          }),
        })),
      pollPending: async () => {
        const { entries, updateStatus } = get();
        const pendingTxs = entries.filter((e) => e.status === 'pending' && e.chain === 'stellar');

        for (const tx of pendingTxs) {
          try {
            const res = await fetch(`${STELLAR_NETWORK.horizonUrl}/transactions/${tx.id}`);
            if (res.ok) {
              const data = await res.json();
              if (data.successful) {
                updateStatus(tx.id, 'confirmed');
              } else {
                updateStatus(tx.id, 'failed');
              }
            } else if (res.status === 404) {
              // If it's older than 5 minutes and still 404, mark as failed
              if (Date.now() - tx.timestamp > 5 * 60 * 1000) {
                updateStatus(tx.id, 'failed');
              }
            }
            // Some other error — don't change status
          } catch {
            // Ignore fetch errors to keep polling next time
          }
        }
      },
    }),
    {
      name: 'wraith-activity-storage',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      migrate(persistedState: any, fromVersion: number) {
        if (fromVersion < 1) {
          // v0 → v1: backfill profileId: 'default' on all existing entries
          const state = persistedState as { entries?: any[] };
          if (Array.isArray(state.entries)) {
            state.entries = state.entries.map((e: any) => ({
              ...e,
              profileId: e.profileId ?? DEFAULT_PROFILE_ID,
            }));
          }
        }
        return persistedState as ActivityState;
      },
    },
  ),
);
