import { useState, useCallback } from 'react';
import {
  getLabels,
  saveLabel as storageSaveLabel,
  hideAddress as storageHideAddress,
  unhideAddress as storageUnhideAddress,
  deleteLabel as storageDeleteLabel,
  getAllTags as storageGetAllTags,
  exportLabels as storageExportLabels,
  importLabels as storageImportLabels,
  mergeConflicts as storageMergeConflicts,
  hasShownPrivacyWarning,
  markPrivacyWarningShown,
  type StealthLabel,
  type ImportResult,
} from '@/lib/stealthLabels';

export function useStealthLabels(walletPubkey: string | null) {
  const [labels, setLabels] = useState<Record<string, StealthLabel>>(() =>
    walletPubkey ? getLabels(walletPubkey) : {},
  );
  const [privacyWarningDismissed, setPrivacyWarningDismissed] = useState(hasShownPrivacyWarning);

  const refresh = useCallback(() => {
    if (walletPubkey) {
      setLabels(getLabels(walletPubkey));
    }
  }, [walletPubkey]);

  const saveLabel = useCallback(
    (stealthAddress: string, label: string, tags: string[]) => {
      if (!walletPubkey) return;
      storageSaveLabel(walletPubkey, stealthAddress, label, tags);
      refresh();
    },
    [walletPubkey, refresh],
  );

  const hideAddress = useCallback(
    (stealthAddress: string) => {
      if (!walletPubkey) return;
      storageHideAddress(walletPubkey, stealthAddress);
      refresh();
    },
    [walletPubkey, refresh],
  );

  const unhideAddress = useCallback(
    (stealthAddress: string) => {
      if (!walletPubkey) return;
      storageUnhideAddress(walletPubkey, stealthAddress);
      refresh();
    },
    [walletPubkey, refresh],
  );

  const removeLabel = useCallback(
    (stealthAddress: string) => {
      if (!walletPubkey) return;
      storageDeleteLabel(walletPubkey, stealthAddress);
      refresh();
    },
    [walletPubkey, refresh],
  );

  const getAllTags = useCallback((): string[] => {
    if (!walletPubkey) return [];
    return storageGetAllTags(walletPubkey);
  }, [walletPubkey]);

  const doExportLabels = useCallback((): string => {
    if (!walletPubkey) return '{}';
    return storageExportLabels(walletPubkey);
  }, [walletPubkey]);

  const doImportLabels = useCallback(
    (json: string, overwriteConflicts: boolean = false): ImportResult => {
      if (!walletPubkey) return { imported: 0, conflicts: [] };
      const result = storageImportLabels(walletPubkey, json, overwriteConflicts);
      refresh();
      return result;
    },
    [walletPubkey, refresh],
  );

  const doMergeConflicts = useCallback(
    (resolutions: Record<string, StealthLabel>) => {
      if (!walletPubkey) return;
      storageMergeConflicts(walletPubkey, resolutions);
      refresh();
    },
    [walletPubkey, refresh],
  );

  const shouldShowPrivacyWarning = !privacyWarningDismissed;

  const dismissPrivacyWarning = useCallback(() => {
    markPrivacyWarningShown();
    setPrivacyWarningDismissed(true);
  }, []);

  return {
    labels,
    saveLabel,
    hideAddress,
    unhideAddress,
    removeLabel,
    getAllTags,
    exportLabels: doExportLabels,
    importLabels: doImportLabels,
    mergeConflicts: doMergeConflicts,
    shouldShowPrivacyWarning,
    dismissPrivacyWarning,
    refresh,
  };
}
