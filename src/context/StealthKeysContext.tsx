import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { StellarWalletContext } from '@/context/StellarWalletContext';
import type { StealthKeys as EVMStealthKeys } from '@wraith-protocol/sdk/chains/evm';
import type { StealthKeys as StellarStealthKeys } from '@wraith-protocol/sdk/chains/stellar';
import type { StealthKeys as SolanaStealthKeys } from '@wraith-protocol/sdk/chains/solana';
import type { StealthKeys as CKBStealthKeys } from '@wraith-protocol/sdk/chains/ckb';
import { useProfilesStore, DEFAULT_PROFILE_ID } from '@/store/profilesStore';

// ---------------------------------------------------------------------------
// Per-profile key cache shape
// ---------------------------------------------------------------------------

interface ProfileKeySlot {
  evmKeys: EVMStealthKeys | null;
  evmMetaAddress: string | null;
  stellarKeys: StellarStealthKeys | null;
  stellarMetaAddress: string | null;
  solanaKeys: SolanaStealthKeys | null;
  solanaMetaAddress: string | null;
  ckbKeys: CKBStealthKeys | null;
  ckbMetaAddress: string | null;
}

function emptySlot(): ProfileKeySlot {
  return {
    evmKeys: null,
    evmMetaAddress: null,
    stellarKeys: null,
    stellarMetaAddress: null,
    solanaKeys: null,
    solanaMetaAddress: null,
    ckbKeys: null,
    ckbMetaAddress: null,
  };
}

// ---------------------------------------------------------------------------
// Context value interface
//
// Public API is identical to before — callers read/write the active profile's
// keys transparently.  The per-profile storage is internal to the provider.
// ---------------------------------------------------------------------------

interface StealthKeysContextValue {
  // Active-profile keys (read-only convenience accessors)
  evmKeys: EVMStealthKeys | null;
  evmMetaAddress: string | null;
  stellarKeys: StellarStealthKeys | null;
  stellarMetaAddress: string | null;
  solanaKeys: SolanaStealthKeys | null;
  solanaMetaAddress: string | null;
  ckbKeys: CKBStealthKeys | null;
  ckbMetaAddress: string | null;

  // Setters (write into the active profile's slot)
  setEvmKeys: (keys: EVMStealthKeys) => void;
  setEvmMetaAddress: (metaAddress: string) => void;
  setStellarKeys: (keys: StellarStealthKeys) => void;
  setStellarMetaAddress: (metaAddress: string) => void;
  setSolanaKeys: (keys: SolanaStealthKeys) => void;
  setSolanaMetaAddress: (metaAddress: string) => void;
  setCkbKeys: (keys: CKBStealthKeys) => void;
  setCkbMetaAddress: (metaAddress: string) => void;

  // Clears scoped to the active profile only
  clearEvm: () => void;
  clearStellar: () => void;
  clearSolana: () => void;
  clearCkb: () => void;

  // Read keys for any profile (used by ProfileSwitcher preview etc.)
  getKeysForProfile: (profileId: string) => ProfileKeySlot;
}

export const StealthKeysContext = createContext<StealthKeysContextValue | null>(null);

// ---------------------------------------------------------------------------
// Subscribes clearStellar (for the active profile) to StellarWalletContext's
// disconnect listener.  Rendered inside StealthKeysProvider so it can consume
// both contexts.
// ---------------------------------------------------------------------------

function StealthKeysCleaner({ clearStellar }: { clearStellar: () => void }) {
  const stellar = useContext(StellarWalletContext);
  const subscribeToDisconnect = stellar?.subscribeToDisconnect;
  useEffect(() => {
    if (!subscribeToDisconnect) return;
    return subscribeToDisconnect(clearStellar);
  }, [subscribeToDisconnect, clearStellar]);
  return null;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function StealthKeysProvider({ children }: { children: React.ReactNode }) {
  // Map from profileId → key slot.  We keep this in React state so that
  // changes to any profile's keys trigger re-renders in subscribers.
  const [keysByProfile, setKeysByProfile] = useState<Map<string, ProfileKeySlot>>(
    () => new Map([[DEFAULT_PROFILE_ID, emptySlot()]]),
  );

  const activeProfileId = useProfilesStore((s) => s.activeProfileId);

  // When the active profile changes, ensure the new profile has a slot.
  useEffect(() => {
    setKeysByProfile((prev) => {
      if (prev.has(activeProfileId)) return prev;
      const next = new Map(prev);
      next.set(activeProfileId, emptySlot());
      return next;
    });
  }, [activeProfileId]);

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  const getSlot = useCallback(
    (profileId: string): ProfileKeySlot => {
      return keysByProfile.get(profileId) ?? emptySlot();
    },
    [keysByProfile],
  );

  const patchSlot = useCallback((profileId: string, patch: Partial<ProfileKeySlot>) => {
    setKeysByProfile((prev) => {
      const next = new Map(prev);
      const existing = next.get(profileId) ?? emptySlot();
      next.set(profileId, { ...existing, ...patch });
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Active-profile key accessors (stable via useMemo so consumers don't
  // re-render on every keysByProfile map update)
  // ---------------------------------------------------------------------------

  const activeSlot = useMemo(() => getSlot(activeProfileId), [getSlot, activeProfileId]);

  // ---------------------------------------------------------------------------
  // Setters — always write into the ACTIVE profile's slot
  // ---------------------------------------------------------------------------

  const setEvmKeys = useCallback(
    (keys: EVMStealthKeys) => patchSlot(activeProfileId, { evmKeys: keys }),
    [patchSlot, activeProfileId],
  );
  const setEvmMetaAddress = useCallback(
    (metaAddress: string) => patchSlot(activeProfileId, { evmMetaAddress: metaAddress }),
    [patchSlot, activeProfileId],
  );
  const setStellarKeys = useCallback(
    (keys: StellarStealthKeys) => patchSlot(activeProfileId, { stellarKeys: keys }),
    [patchSlot, activeProfileId],
  );
  const setStellarMetaAddress = useCallback(
    (metaAddress: string) => patchSlot(activeProfileId, { stellarMetaAddress: metaAddress }),
    [patchSlot, activeProfileId],
  );
  const setSolanaKeys = useCallback(
    (keys: SolanaStealthKeys) => patchSlot(activeProfileId, { solanaKeys: keys }),
    [patchSlot, activeProfileId],
  );
  const setSolanaMetaAddress = useCallback(
    (metaAddress: string) => patchSlot(activeProfileId, { solanaMetaAddress: metaAddress }),
    [patchSlot, activeProfileId],
  );
  const setCkbKeys = useCallback(
    (keys: CKBStealthKeys) => patchSlot(activeProfileId, { ckbKeys: keys }),
    [patchSlot, activeProfileId],
  );
  const setCkbMetaAddress = useCallback(
    (metaAddress: string) => patchSlot(activeProfileId, { ckbMetaAddress: metaAddress }),
    [patchSlot, activeProfileId],
  );

  // ---------------------------------------------------------------------------
  // Clears — scoped to the active profile only (do NOT wipe other profiles)
  // ---------------------------------------------------------------------------

  const clearEvm = useCallback(
    () => patchSlot(activeProfileId, { evmKeys: null, evmMetaAddress: null }),
    [patchSlot, activeProfileId],
  );
  const clearStellar = useCallback(
    () => patchSlot(activeProfileId, { stellarKeys: null, stellarMetaAddress: null }),
    [patchSlot, activeProfileId],
  );
  const clearSolana = useCallback(
    () => patchSlot(activeProfileId, { solanaKeys: null, solanaMetaAddress: null }),
    [patchSlot, activeProfileId],
  );
  const clearCkb = useCallback(
    () => patchSlot(activeProfileId, { ckbKeys: null, ckbMetaAddress: null }),
    [patchSlot, activeProfileId],
  );

  // Read keys for any profile (e.g. ProfileSwitcher preview)
  const getKeysForProfile = useCallback((id: string) => getSlot(id), [getSlot]);

  const value = useMemo<StealthKeysContextValue>(
    () => ({
      // Active-profile flat accessors (identical API to the original context)
      evmKeys: activeSlot.evmKeys,
      evmMetaAddress: activeSlot.evmMetaAddress,
      stellarKeys: activeSlot.stellarKeys,
      stellarMetaAddress: activeSlot.stellarMetaAddress,
      solanaKeys: activeSlot.solanaKeys,
      solanaMetaAddress: activeSlot.solanaMetaAddress,
      ckbKeys: activeSlot.ckbKeys,
      ckbMetaAddress: activeSlot.ckbMetaAddress,
      // Setters
      setEvmKeys,
      setEvmMetaAddress,
      setStellarKeys,
      setStellarMetaAddress,
      setSolanaKeys,
      setSolanaMetaAddress,
      setCkbKeys,
      setCkbMetaAddress,
      // Clears
      clearEvm,
      clearStellar,
      clearSolana,
      clearCkb,
      // Cross-profile read
      getKeysForProfile,
    }),
    [
      activeSlot,
      setEvmKeys,
      setEvmMetaAddress,
      setStellarKeys,
      setStellarMetaAddress,
      setSolanaKeys,
      setSolanaMetaAddress,
      setCkbKeys,
      setCkbMetaAddress,
      clearEvm,
      clearStellar,
      clearSolana,
      clearCkb,
      getKeysForProfile,
    ],
  );

  return (
    <StealthKeysContext.Provider value={value}>
      <StealthKeysCleaner clearStellar={clearStellar} />
      {children}
    </StealthKeysContext.Provider>
  );
}

export function useStealthKeys() {
  const ctx = useContext(StealthKeysContext);
  if (!ctx) throw new Error('useStealthKeys must be used within StealthKeysProvider');
  return ctx;
}
