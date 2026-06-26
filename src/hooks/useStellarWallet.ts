/**
 * src/hooks/useStellarWallet.ts
 *
 * Central hook for Stellar wallet state. Manages:
 *   - Which wallet the user has chosen (persisted to localStorage)
 *   - Connection state (publicKey, network)
 *   - Whether the picker modal is open
 *   - Auto-reconnect on mount when a last-used wallet is stored
 *
 * Used by StellarSend, StellarReceive, and StealthKeysContext.
 * Replaces direct @stellar/freighter-api calls throughout the app.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getAdapter,
  WALLET_IDS,
  type StellarWallet,
  type WalletId,
} from '@/wallets/stellar';

const STORAGE_KEY_WALLET   = 'wraith:stellar:wallet';
const STORAGE_KEY_PUBKEY   = 'wraith:stellar:pubkey';
const STORAGE_KEY_NETWORK  = 'wraith:stellar:network';

export type WalletStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface StellarWalletState {
  /** Currently active wallet instance, or null. */
  wallet: StellarWallet | null;
  walletId: WalletId | null;
  publicKey: string | null;
  network: string | null;
  status: WalletStatus;
  error: string | null;
  /** True while availability checks are running on mount. */
  detecting: boolean;
  /** Availability map populated after detection. */
  available: Partial<Record<WalletId, boolean>>;
  /** Open the wallet picker modal. */
  openPicker: () => void;
  /** Close the wallet picker without selecting. */
  closePicker: () => void;
  pickerOpen: boolean;
  /** Attempt to connect with the given wallet ID. */
  connect: (id: WalletId) => Promise<void>;
  /** Disconnect and clear persisted state. */
  disconnect: () => Promise<void>;
  /** Sign a transaction with the active wallet. */
  signTransaction: (xdr: string, networkPassphrase?: string) => Promise<string>;
  /** Set a pre-connected wallet (for WalletConnect QR flow). */
  setPreconnectedWallet: (wallet: StellarWallet, id: WalletId, publicKey: string, network: string) => void;
}

export function useStellarWallet(): StellarWalletState {
  const [walletId, setWalletId]     = useState<WalletId | null>(null);
  const [wallet, setWallet]         = useState<StellarWallet | null>(null);
  const [publicKey, setPublicKey]   = useState<string | null>(null);
  const [network, setNetwork]       = useState<string | null>(null);
  const [status, setStatus]         = useState<WalletStatus>('idle');
  const [error, setError]           = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detecting, setDetecting]   = useState(true);
  const [available, setAvailable]   = useState<Partial<Record<WalletId, boolean>>>({});

  const connectingRef = useRef(false);

  // ── Detection + auto-reconnect on mount ────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Detect all wallets in parallel
      const results = await Promise.all(
        WALLET_IDS.map(async (id) => {
          const adapter = getAdapter(id);
          const avail = await adapter.isAvailable();
          return [id, avail] as const;
        }),
      );

      if (cancelled) return;
      const map: Partial<Record<WalletId, boolean>> = {};
      results.forEach(([id, avail]) => { map[id] = avail; });
      setAvailable(map);
      setDetecting(false);

      // Auto-reconnect if we have a persisted session
      const savedId  = localStorage.getItem(STORAGE_KEY_WALLET) as WalletId | null;
      const savedKey = localStorage.getItem(STORAGE_KEY_PUBKEY);
      const savedNet = localStorage.getItem(STORAGE_KEY_NETWORK);

      if (savedId && savedKey && savedNet && map[savedId]) {
        const adapter = getAdapter(savedId);
        setWallet(adapter);
        setWalletId(savedId);
        setPublicKey(savedKey);
        setNetwork(savedNet);
        setStatus('connected');
      }
    }

    init().catch(console.error);
    return () => { cancelled = true; };
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────

  const openPicker  = useCallback(() => setPickerOpen(true),  []);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  const connect = useCallback(async (id: WalletId) => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setStatus('connecting');
    setError(null);

    try {
      const adapter = getAdapter(id);
      const result  = await adapter.connect();

      setWallet(adapter);
      setWalletId(id);
      setPublicKey(result.publicKey);
      setNetwork(result.network);
      setStatus('connected');
      setPickerOpen(false);

      // Persist for auto-reconnect
      localStorage.setItem(STORAGE_KEY_WALLET,  id);
      localStorage.setItem(STORAGE_KEY_PUBKEY,  result.publicKey);
      localStorage.setItem(STORAGE_KEY_NETWORK, result.network);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      connectingRef.current = false;
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (wallet) {
      try { await wallet.disconnect(); } catch { /* best-effort */ }
    }
    setWallet(null);
    setWalletId(null);
    setPublicKey(null);
    setNetwork(null);
    setStatus('idle');
    setError(null);
    localStorage.removeItem(STORAGE_KEY_WALLET);
    localStorage.removeItem(STORAGE_KEY_PUBKEY);
    localStorage.removeItem(STORAGE_KEY_NETWORK);
  }, [wallet]);

  const signTransaction = useCallback(async (xdr: string, networkPassphrase?: string) => {
    if (!wallet) throw new Error('No wallet connected');
    const result = await wallet.signTransaction(xdr, {
      networkPassphrase,
      publicKey: publicKey ?? undefined,
    });
    return result.signedXdr;
  }, [wallet, publicKey]);

  const setPreconnectedWallet = useCallback((preconnectedWallet: StellarWallet, id: WalletId, pk: string, net: string) => {
    setWallet(preconnectedWallet);
    setWalletId(id);
    setPublicKey(pk);
    setNetwork(net);
    setStatus('connected');
    setPickerOpen(false);

    // Persist for auto-reconnect
    localStorage.setItem(STORAGE_KEY_WALLET, id);
    localStorage.setItem(STORAGE_KEY_PUBKEY, pk);
    localStorage.setItem(STORAGE_KEY_NETWORK, net);
  }, []);

  return {
    wallet, walletId, publicKey, network,
    status, error, detecting, available,
    pickerOpen, openPicker, closePicker,
    connect, disconnect, signTransaction, setPreconnectedWallet,
  };
}