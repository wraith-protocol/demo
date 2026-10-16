import { create } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';
import {
  MAX_COLLECTION_ITEMS,
  isBoundedString,
  isFiniteTimestamp,
  readVersionedValue,
  writeVersioned,
} from '../lib/versionedStorage';

export interface WatchedNameAuction {
  name: string;
  endsAt: number;
}

export interface LocalAuctionBid {
  name: string;
  amountStroops: string;
  depositStroops: string;
  saltHex: string;
  revealed: boolean;
}

interface NameWatchlistState {
  watchedAuctions: WatchedNameAuction[];
  bids: Record<string, LocalAuctionBid>;
  watchAuction: (auction: WatchedNameAuction) => void;
  unwatchAuction: (name: string) => void;
  saveBid: (bid: LocalAuctionBid) => void;
  markBidRevealed: (name: string) => void;
  removeBid: (name: string) => void;
}

type PersistedWatchlist = Pick<NameWatchlistState, 'watchedAuctions' | 'bids'>;

function isPersistedWatchlist(value: unknown): value is PersistedWatchlist {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Record<string, unknown>;
  if (
    !Array.isArray(state.watchedAuctions) ||
    typeof state.bids !== 'object' ||
    state.bids === null
  ) {
    return false;
  }
  const watched = state.watchedAuctions as unknown[];
  const bids = state.bids as Record<string, unknown>;
  return (
    watched.length <= MAX_COLLECTION_ITEMS &&
    Object.keys(bids).length <= MAX_COLLECTION_ITEMS &&
    watched.every((item) => {
      if (typeof item !== 'object' || item === null) return false;
      const auction = item as Record<string, unknown>;
      return (
        isBoundedString(auction.name, 128) &&
        auction.name.length > 0 &&
        isFiniteTimestamp(auction.endsAt)
      );
    }) &&
    Object.values(bids).every((item) => {
      if (typeof item !== 'object' || item === null) return false;
      const bid = item as Record<string, unknown>;
      return (
        isBoundedString(bid.name, 128) &&
        isBoundedString(bid.amountStroops, 80) &&
        isBoundedString(bid.depositStroops, 80) &&
        isBoundedString(bid.saltHex, 256) &&
        typeof bid.revealed === 'boolean'
      );
    })
  );
}

const watchlistStorage: PersistStorage<NameWatchlistState> = {
  getItem: (name) => {
    const state = readVersionedValue<PersistedWatchlist>(
      localStorage,
      name,
      isPersistedWatchlist,
      (value) => {
        const legacy = value as { state?: unknown };
        return legacy.state;
      },
    );
    return state ? { state: state as NameWatchlistState, version: 1 } : null;
  },
  setItem: (name, value) =>
    writeVersioned(localStorage, name, {
      watchedAuctions: value.state.watchedAuctions,
      bids: value.state.bids,
    }),
  removeItem: (name) => localStorage.removeItem(name),
};

const normalizeName = (name: string) => name.trim().toLowerCase();

export const useNameWatchlistStore = create<NameWatchlistState>()(
  persist(
    (set) => ({
      watchedAuctions: [],
      bids: {},
      watchAuction: (auction: WatchedNameAuction) =>
        set((state: NameWatchlistState) => {
          const name = normalizeName(auction.name);
          return {
            watchedAuctions: [
              ...state.watchedAuctions.filter((item) => item.name !== name),
              { ...auction, name },
            ],
          };
        }),
      unwatchAuction: (name: string) =>
        set((state: NameWatchlistState) => ({
          watchedAuctions: state.watchedAuctions.filter(
            (item) => item.name !== normalizeName(name),
          ),
        })),
      saveBid: (bid: LocalAuctionBid) =>
        set((state: NameWatchlistState) => {
          const name = normalizeName(bid.name);
          return { bids: { ...state.bids, [name]: { ...bid, name } } };
        }),
      markBidRevealed: (name: string) =>
        set((state: NameWatchlistState) => {
          const key = normalizeName(name);
          const bid = state.bids[key];
          if (!bid) return state;
          return { bids: { ...state.bids, [key]: { ...bid, revealed: true } } };
        }),
      removeBid: (name: string) =>
        set((state: NameWatchlistState) => {
          const bids = { ...state.bids };
          delete bids[normalizeName(name)];
          return { bids };
        }),
    }),
    { name: 'wraith-name-auction-watchlist', storage: watchlistStorage, version: 1 },
  ),
);

let storageListener: ((e: StorageEvent) => void) | null = null;

export function initNameWatchlistSync() {
  if (typeof window === 'undefined' || storageListener !== null) return;
  if (typeof window.addEventListener !== 'function') return;

  storageListener = (e: StorageEvent) => {
    if (e.key === 'wraith-name-auction-watchlist') {
      if (e.newValue) {
        useNameWatchlistStore.persist.rehydrate();
      } else {
        useNameWatchlistStore.setState({ watchedAuctions: [], bids: {} });
      }
    } else if (e.key === null) {
      useNameWatchlistStore.setState({ watchedAuctions: [], bids: {} });
    }
  };

  window.addEventListener('storage', storageListener);
}

export function cleanupNameWatchlistSync() {
  if (storageListener === null) return;
  if (typeof window.removeEventListener !== 'function') {
    storageListener = null;
    return;
  }
  window.removeEventListener('storage', storageListener);
  storageListener = null;
}
