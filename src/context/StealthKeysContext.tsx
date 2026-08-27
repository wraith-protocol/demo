import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { StellarWalletContext } from '@/context/StellarWalletContext';
import type { StealthKeys as EVMStealthKeys } from '@wraith-protocol/sdk/chains/evm';
import type { StealthKeys as StellarStealthKeys } from '@wraith-protocol/sdk/chains/stellar';
import type { StealthKeys as SolanaStealthKeys } from '@wraith-protocol/sdk/chains/solana';
import type { StealthKeys as CKBStealthKeys } from '@wraith-protocol/sdk/chains/ckb';
import { useProfilesStore, DEFAULT_PROFILE_ID } from '@/store/profilesStore';
import { hexToBytes, type RecoveryKitData } from '@/lib/stellar/recoveryKit';
import { importLabels } from '@/lib/stealthLabels';

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

interface StealthKeysContextValue {
  evmKeys: EVMStealthKeys | null;
  evmMetaAddress: string | null;
  stellarKeys: StellarStealthKeys | null;
  stellarMetaAddress: string | null;
  solanaKeys: SolanaStealthKeys | null;
  solanaMetaAddress: string | null;
  ckbKeys: CKBStealthKeys | null;
  ckbMetaAddress: string | null;

  isRecoveryMode: boolean;
  isReadOnly: boolean;
  setIsRecoveryMode: (active: boolean) => void;
  setIsReadOnly: (readOnly: boolean) => void;
  restoreFromRecoveryKit: (kitData: RecoveryKitData) => void;
  exitRecoveryMode: () => void;

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

  getKeysForProfile: (profileId: string) => ProfileKeySlot;
}

export const StealthKeysContext = createContext<StealthKeysContextValue | null>(null);

function StealthKeysCleaner({ clearStellar }: { clearStellar: () => void }) {
  const stellar = useContext(StellarWalletContext);
  const subscribeToDisconnect = stellar?.subscribeToDisconnect;
  useEffect(() => {
    if (!subscribeToDisconnect) return;
    return subscribeToDisconnect(clearStellar);
  }, [subscribeToDisconnect, clearStellar]);
  return null;
}

export function StealthKeysProvider({ children }: { children: React.ReactNode }) {
  const [keysByProfile, setKeysByProfile] = useState<Map<string, ProfileKeySlot>>(
    () => new Map([[DEFAULT_PROFILE_ID, emptySlot()]]),
  );

  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [isReadOnly, setIsReadOnly] = useState(false);

  const activeProfileId = useProfilesStore((s) => s.activeProfileId);

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

  const clearEvm = useCallback(() => {
    if (isRecoveryMode) return;
    patchSlot(activeProfileId, { evmKeys: null, evmMetaAddress: null });
  }, [isRecoveryMode, patchSlot, activeProfileId]);

  const clearStellar = useCallback(() => {
    if (isRecoveryMode) return;
    patchSlot(activeProfileId, { stellarKeys: null, stellarMetaAddress: null });
  }, [isRecoveryMode, patchSlot, activeProfileId]);

  const clearSolana = useCallback(() => {
    if (isRecoveryMode) return;
    patchSlot(activeProfileId, { solanaKeys: null, solanaMetaAddress: null });
  }, [isRecoveryMode, patchSlot, activeProfileId]);

  const clearCkb = useCallback(() => {
    if (isRecoveryMode) return;
    patchSlot(activeProfileId, { ckbKeys: null, ckbMetaAddress: null });
  }, [isRecoveryMode, patchSlot, activeProfileId]);

  const exitRecoveryMode = useCallback(() => {
    setIsRecoveryMode(false);
    setIsReadOnly(false);
    patchSlot(activeProfileId, emptySlot());
  }, [patchSlot, activeProfileId]);

  const restoreFromRecoveryKit = useCallback(
    (kitData: RecoveryKitData) => {
      setIsRecoveryMode(true);
      setIsReadOnly(!kitData.spendingScalarHex);

      const viewingKey = kitData.viewingScalarHex
        ? hexToBytes(kitData.viewingScalarHex)
        : new Uint8Array(32);
      const spendingPubKey = kitData.spendingPubKeyHex
        ? hexToBytes(kitData.spendingPubKeyHex)
        : new Uint8Array(32);
      const viewingPubKey = kitData.viewingPubKeyHex
        ? hexToBytes(kitData.viewingPubKeyHex)
        : new Uint8Array(32);
      const spendingScalar = kitData.spendingScalarHex
        ? BigInt(
            kitData.spendingScalarHex.startsWith('0x')
              ? kitData.spendingScalarHex
              : `0x${kitData.spendingScalarHex}`,
          )
        : undefined;

      const chain = kitData.chain?.toLowerCase() || '';

      if (chain === 'stellar' || kitData.metaAddress?.startsWith('st:xlm:')) {
        const keys: any = {
          viewingKey,
          viewingScalar: viewingKey,
          spendingKey: spendingPubKey,
          spendingPubKey,
          viewingPubKey,
          spendingScalar,
        };
        patchSlot(activeProfileId, {
          stellarKeys: keys as StellarStealthKeys,
          stellarMetaAddress: kitData.metaAddress,
        });
      } else if (chain === 'horizen' || kitData.metaAddress?.startsWith('st:eth:')) {
        const keys: any = {
          viewingKey: kitData.viewingScalarHex,
          spendingPubKey: kitData.spendingPubKeyHex || '',
          viewingPubKey: kitData.viewingPubKeyHex || '',
          spendingScalar: kitData.spendingScalarHex || '',
        };
        patchSlot(activeProfileId, {
          evmKeys: keys as EVMStealthKeys,
          evmMetaAddress: kitData.metaAddress,
        });
      } else if (chain === 'solana' || kitData.metaAddress?.startsWith('st:sol:')) {
        const keys: any = {
          viewingKey,
          viewingScalar: viewingKey,
          spendingKey: spendingPubKey,
          spendingPubKey,
          viewingPubKey,
          spendingScalar,
        };
        patchSlot(activeProfileId, {
          solanaKeys: keys as SolanaStealthKeys,
          solanaMetaAddress: kitData.metaAddress,
        });
      } else if (chain === 'ckb' || kitData.metaAddress?.startsWith('st:ckb:')) {
        const keys: any = {
          viewingKey: kitData.viewingScalarHex,
          spendingPubKey: kitData.spendingPubKeyHex || '',
          viewingPubKey: kitData.viewingPubKeyHex || '',
          spendingScalar: kitData.spendingScalarHex || '',
        };
        patchSlot(activeProfileId, {
          ckbKeys: keys as CKBStealthKeys,
          ckbMetaAddress: kitData.metaAddress,
        });
      } else {
        const keys: any = {
          viewingKey,
          viewingScalar: viewingKey,
          spendingKey: spendingPubKey,
          spendingPubKey,
          viewingPubKey,
          spendingScalar,
        };
        patchSlot(activeProfileId, {
          stellarKeys: keys as StellarStealthKeys,
          stellarMetaAddress: kitData.metaAddress,
        });
      }

      if (kitData.labels) {
        try {
          importLabels(kitData.metaAddress, JSON.stringify(kitData.labels), true);
        } catch {
          // Labels restore optional
        }
      }
    },
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
      isRecoveryMode,
      isReadOnly,
      setIsRecoveryMode,
      setIsReadOnly,
      restoreFromRecoveryKit,
      exitRecoveryMode,
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
      isRecoveryMode,
      isReadOnly,
      restoreFromRecoveryKit,
      exitRecoveryMode,
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
