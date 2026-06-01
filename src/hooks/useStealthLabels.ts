import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  type StealthLabel,
  MAX_LABEL_LENGTH,
  getLabels,
  upsertLabel,
  hideLabel as storeHide,
  unhideLabel as storeUnhide,
  exportLabels,
  importLabels,
  isPrivacyDismissed,
  dismissPrivacy,
} from '@/lib/stealth-labels';

export function useStealthLabels(walletId: string | undefined) {
  const [labels, setLabels] = useState<StealthLabel[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [showPrivacyWarning, setShowPrivacyWarning] = useState(false);

  useEffect(() => {
    if (walletId) {
      setLabels(getLabels(walletId));
    } else {
      setLabels([]);
    }
  }, [walletId]);

  const dismissPrivacyWarning = useCallback(() => {
    dismissPrivacy();
    setShowPrivacyWarning(false);
  }, []);

  const refresh = useCallback(() => {
    if (walletId) setLabels(getLabels(walletId));
  }, [walletId]);

  const setLabel = useCallback(
    (stealthAddress: string, text: string) => {
      if (!walletId) return;
      const existing = getLabels(walletId);
      const existingLabel = existing.find((l) => l.stealthAddress === stealthAddress);
      if (existing.length === 0 && !isPrivacyDismissed()) {
        setShowPrivacyWarning(true);
      }
      upsertLabel(walletId, {
        stealthAddress,
        label: text.slice(0, MAX_LABEL_LENGTH),
        tags: existingLabel?.tags ?? [],
        createdAt: existingLabel?.createdAt ?? Date.now(),
      });
      refresh();
    },
    [walletId, refresh],
  );

  const setTags = useCallback(
    (stealthAddress: string, tags: string[]) => {
      if (!walletId) return;
      const existing = getLabels(walletId);
      const existingLabel = existing.find((l) => l.stealthAddress === stealthAddress);
      if (existing.length === 0 && !isPrivacyDismissed()) {
        setShowPrivacyWarning(true);
      }
      upsertLabel(walletId, {
        stealthAddress,
        label: existingLabel?.label ?? '',
        tags,
        createdAt: existingLabel?.createdAt ?? Date.now(),
      });
      refresh();
    },
    [walletId, refresh],
  );

  const hide = useCallback(
    (stealthAddress: string) => {
      if (!walletId) return;
      storeHide(walletId, stealthAddress);
      refresh();
    },
    [walletId, refresh],
  );

  const unhide = useCallback(
    (stealthAddress: string) => {
      if (!walletId) return;
      storeUnhide(walletId, stealthAddress);
      refresh();
    },
    [walletId, refresh],
  );

  const doExport = useCallback((): StealthLabel[] => {
    if (!walletId) return [];
    return exportLabels(walletId);
  }, [walletId]);

  const doImport = useCallback(
    (imported: StealthLabel[], overwrite: boolean): { merged: number; added: number } => {
      if (!walletId) return { merged: 0, added: 0 };
      const result = importLabels(walletId, imported, overwrite);
      refresh();
      return result;
    },
    [walletId, refresh],
  );

  const filteredLabels = useMemo(() => {
    return labels.filter((l) => {
      if (!showHidden && l.hiddenAt) return false;
      if (activeTag && !l.tags.includes(activeTag)) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          l.label.toLowerCase().includes(q) ||
          l.tags.some((t) => t.toLowerCase().includes(q)) ||
          l.stealthAddress.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [labels, showHidden, activeTag, searchQuery]);

  const allTags = useMemo(() => {
    return Array.from(new Set(labels.flatMap((l) => l.tags)));
  }, [labels]);

  const getLabel = useCallback(
    (stealthAddress: string): StealthLabel | undefined => {
      return labels.find((l) => l.stealthAddress === stealthAddress);
    },
    [labels],
  );

  return {
    labels,
    filteredLabels,
    allTags,
    getLabel,
    setLabel,
    setTags,
    hide,
    unhide,
    searchQuery,
    setSearchQuery,
    activeTag,
    setActiveTag,
    showHidden,
    setShowHidden,
    showPrivacyWarning,
    dismissPrivacyWarning,
    export: doExport,
    import: doImport,
  };
}
