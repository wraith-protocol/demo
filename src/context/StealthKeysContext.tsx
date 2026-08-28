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
// Context interface — profile-scoped keys only (no recovery-kit fields)
// ---------------------------------------------------------------------------

interface StealthKeysContextValue {
  evmKeys: EVMStealthKeys | null;
  evmMetaAddress: string | null;
  stellarKeys: StellarStealthKeys | null;
  stellarMetaAddress: string | null;
  solanaKeys: SolanaStealthKeys | null;
  solanaMetaAddress: string | null;
  ckbKeys: CKBStealthKeys | null;
  ckbMetaAddress: string | null;

  setEvmKeys: (keys: EVMStealthKeys) => void;
  setEvmMetaAddress: (metaAddress: string) => void;
  setStellarKeys: (keys: StellarStealthKeys) => void;
  setStellarMetaAddress: (metaAddress: string) => void;
  setSolanaKeys: (keys: SolanaStealthKeys) => void;
  setSolanaMetaAddress: (metaAddress: string) => void;
  setCkbKeys: (keys: CKBStealthKeys) => void;
  setCkbMetaAddress: (metaAddress: string) => void;

  clearEvm: () => void;
  clearStellar: () => void;
  clearSolana: () => void;
  clearCkb: () => void;

  /** Read keys for any profile (e.g. ProfileSwitcher preview). */
  getKeysForProfile: (profileId: string) => ProfileKeySlot;
}

export const StealthKeysContext = createContext<StealthKeysContextValue | null>(null);

// ---------------------------------------------------------------------------
// Subscribes clearStellar to StellarWalletContext's disconnect listener.
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
  const [keysByProfile, setKeysByProfile] = useState<Map<string, ProfileKeySlot>>(
    () => new Map([[DEFAULT_PROFILE_ID, emptySlot()]]),
  );

  const activeProfileId = useProfilesStore((s) => s.activeProfileId);

  // Ensure the new profile has a slot when the active profile changes.
  useEffect(() => {
    setKeysByProfile((prev) => {
      if (prev.has(activeProfileId)) return prev;
      const next = new Map(prev);
      next.set(activeProfileId, emptySlot());
      return next;
    });
  }, [activeProfileId]);

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

  const activeSlot = useMemo(() => getSlot(activeProfileId), [getSlot, activeProfileId]);

  // Setters — always write into the active profile's slot
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

  // Clears — scoped to the active profile only
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

  const getKeysForProfile = useCallback((id: string) => getSlot(id), [getSlot]);

  const value = useMemo<StealthKeysContextValue>(
    () => ({
      evmKeys: activeSlot.evmKeys,
      evmMetaAddress: activeSlot.evmMetaAddress,
      stellarKeys: activeSlot.stellarKeys,
      stellarMetaAddress: activeSlot.stellarMetaAddress,
      solanaKeys: activeSlot.solanaKeys,
      solanaMetaAddress: activeSlot.solanaMetaAddress,
      ckbKeys: activeSlot.ckbKeys,
      ckbMetaAddress: activeSlot.ckbMetaAddress,
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
