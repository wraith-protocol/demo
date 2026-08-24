import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

const normalizeName = (name: string) => name.trim().toLowerCase();

export const useNameWatchlistStore = create<NameWatchlistState>()(
  persist(
    (set) => ({
      watchedAuctions: [],
      bids: {},
      watchAuction: (auction) =>
        set((state) => {
          const name = normalizeName(auction.name);
          return {
            watchedAuctions: [
              ...state.watchedAuctions.filter((item) => item.name !== name),
              { ...auction, name },
            ],
          };
        }),
      unwatchAuction: (name) =>
        set((state) => ({
          watchedAuctions: state.watchedAuctions.filter(
            (item) => item.name !== normalizeName(name),
          ),
        })),
      saveBid: (bid) =>
        set((state) => {
          const name = normalizeName(bid.name);
          return { bids: { ...state.bids, [name]: { ...bid, name } } };
        }),
      markBidRevealed: (name) =>
        set((state) => {
          const key = normalizeName(name);
          const bid = state.bids[key];
          if (!bid) return state;
          return { bids: { ...state.bids, [key]: { ...bid, revealed: true } } };
        }),
      removeBid: (name) =>
        set((state) => {
          const bids = { ...state.bids };
          delete bids[normalizeName(name)];
          return { bids };
        }),
    }),
    { name: 'wraith-name-auction-watchlist' },
  ),
);
