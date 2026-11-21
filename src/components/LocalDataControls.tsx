import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStellarWallet } from '@/context/StellarWalletContext';
import {
  LocalDataBlockedError,
  buildDeviceExport,
  buildResetSummary,
  buildWalletExport,
  deleteWalletData,
  localDataExportFilename,
  readLocalDataInventory,
  resetAllLocalData,
  unresolvedBlockers,
  type DeletionReport,
  type DeviceCategoryId,
  type LocalDataExport,
  type LocalDataInventory,
  type LocalDataOptions,
  type WalletCategoryId,
} from '@/lib/localData';
import { createBrowserLocalDataBackends } from '@/lib/localDataBrowser';
import { loadOfflineQueue } from '@/lib/offlineQueue';
import { useActivityStore } from '@/stores/activityStore';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useOfflineQueueStore } from '@/stores/offlineQueueStore';
import { useNameWatchlistStore } from '@/store/nameWatchlistStore';
import { downloadText } from '@/utils/activityExport';
import {
  LocalDataControlsView,
  scopeLabel,
  type LocalDataPendingAction,
  type LocalDataWalletOption,
} from './LocalDataControlsView';

/**
 * The page keeps some stores in memory and writes them back on the next
 * change, which would restore records just deleted from storage. Reload them
 * from storage so memory matches what is left.
 */
function resyncInMemoryStores() {
  void useActivityStore.persist.rehydrate();
  void useNotificationsStore.persist.rehydrate();
  try {
    useOfflineQueueStore.setState({ entries: loadOfflineQueue(localStorage) });
  } catch {
    // Storage became unavailable; the queue store keeps its current entries.
  }
}

function describeReport(report: DeletionReport, prefix: string): string {
  const removed = Object.entries(report.removed).reduce((total, [, count]) => total + count, 0);
  if (report.verified) {
    return `${prefix}: ${removed} item${removed === 1 ? '' : 's'} removed and verified.`;
  }
  const residual = Object.entries(report.residual)
    .filter(([, count]) => count > 0)
    .map(([id, count]) => `${id} (${count})`)
    .join(', ');
  return `${prefix}, but some records are still present: ${residual}. Try again or reload.`;
}

export function LocalDataControls() {
  const { address } = useStellarWallet();
  const auctionStatus = useNameWatchlistStore((state) => state.status);
  const auctionBids = useNameWatchlistStore((state) => state.bids);
  const backends = useMemo(() => createBrowserLocalDataBackends(), []);
  const options = useMemo<LocalDataOptions>(
    () => ({
      unlockedAuctionBids: auctionStatus === 'unlocked' ? Object.values(auctionBids) : undefined,
    }),
    [auctionStatus, auctionBids],
  );

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [inventory, setInventory] = useState<LocalDataInventory | null>(null);
  const [selectedWalletKey, setSelectedWalletKey] = useState<string | null>(null);
  const [walletCategories, setWalletCategories] = useState<Set<WalletCategoryId>>(new Set());
  const [deviceCategories, setDeviceCategories] = useState<Set<DeviceCategoryId>>(new Set());
  const [pending, setPending] = useState<LocalDataPendingAction | null>(null);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setInventory(await readLocalDataInventory(backends, options));
      setStatus('ready');
    } catch (error) {
      console.error('[local-data] Failed to read local data:', error);
      setStatus('error');
    }
  }, [backends, options]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const wallets = useMemo<LocalDataWalletOption[]>(
    () =>
      (inventory?.wallets ?? []).map((wallet) => ({
        key: wallet.key,
        scope: wallet.scope,
        connected: wallet.scope.chain === 'stellar' && wallet.scope.wallet === address,
        totalItems: wallet.totalItems,
        categories: wallet.categories,
      })),
    [inventory, address],
  );

  // Keep the selection on a scope that still exists; prefer the connected wallet.
  useEffect(() => {
    if (wallets.some((wallet) => wallet.key === selectedWalletKey)) return;
    const preferred = wallets.find((wallet) => wallet.connected) ?? wallets[0];
    setSelectedWalletKey(preferred?.key ?? null);
    setWalletCategories(new Set());
  }, [wallets, selectedWalletKey]);

  const selectedWallet = inventory?.wallets.find((wallet) => wallet.key === selectedWalletKey);

  const toggle = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };

  const download = (document: LocalDataExport) => {
    downloadText(
      JSON.stringify(document, null, 2),
      localDataExportFilename(document),
      'application/json;charset=utf-8',
    );
    const withheld = document.withheld.length;
    setMessage({
      type: 'success',
      text: `Exported ${document.categories.filter((c) => c.included).length} categor${
        document.categories.filter((c) => c.included).length === 1 ? 'y' : 'ies'
      }${withheld > 0 ? `; ${withheld} withheld as secret or encrypted (listed in the file)` : ''}.`,
    });
  };

  const closePending = () => {
    setPending(null);
    setResolved(new Set());
    setConfirmation('');
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    setMessage(null);
    try {
      if (pending.kind === 'delete-wallet') {
        const report = await deleteWalletData(
          backends,
          {
            scope: pending.scope,
            categories: [...walletCategories],
            resolvedBlockerIds: [...resolved],
          },
          options,
        );
        resyncInMemoryStores();
        setMessage({
          type: report.verified ? 'success' : 'error',
          text: describeReport(report, `Deleted for ${scopeLabel(pending.scope)}`),
        });
        setWalletCategories(new Set());
        closePending();
        await refresh();
      } else {
        const report = await resetAllLocalData(
          backends,
          { confirmation, resolvedBlockerIds: [...resolved] },
          options,
        );
        if (report.verified) {
          setMessage({
            type: 'success',
            text: describeReport(report, 'Reset complete. Reloading'),
          });
          // Contexts and stores still hold the old data in memory; a reload drops it.
          window.location.reload();
          return;
        }
        setMessage({ type: 'error', text: describeReport(report, 'Reset finished') });
        closePending();
        await refresh();
      }
    } catch (error) {
      if (error instanceof LocalDataBlockedError) {
        // New open transactions appeared since the review: show them for resolution.
        setPending((current) =>
          current?.kind === 'delete-wallet'
            ? { ...current, blockers: error.blockers }
            : current && { ...current, summary: { ...current.summary, blockers: error.blockers } },
        );
      }
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Local data could not be deleted.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <LocalDataControlsView
      status={status}
      wallets={wallets}
      selectedWalletKey={selectedWalletKey}
      selectedWalletCategories={walletCategories}
      device={inventory?.device ?? []}
      selectedDeviceCategories={deviceCategories}
      pending={pending}
      resolvedBlockerIds={resolved}
      confirmation={confirmation}
      busy={busy}
      message={message}
      onSelectWallet={(key) => {
        setSelectedWalletKey(key);
        setWalletCategories(new Set());
        closePending();
      }}
      onToggleWalletCategory={(id) => setWalletCategories((current) => toggle(current, id))}
      onToggleDeviceCategory={(id) => setDeviceCategories((current) => toggle(current, id))}
      onExportWallet={() => {
        if (selectedWallet) download(buildWalletExport(selectedWallet, [...walletCategories]));
      }}
      onExportDevice={() => {
        if (inventory) download(buildDeviceExport(inventory, [...deviceCategories]));
      }}
      onRequestDeleteWallet={() => {
        if (!selectedWallet) return;
        const categories = [...walletCategories];
        setMessage(null);
        setResolved(new Set());
        setPending({
          kind: 'delete-wallet',
          scope: selectedWallet.scope,
          itemCount: selectedWallet.categories
            .filter((category) => walletCategories.has(category.id as WalletCategoryId))
            .reduce((total, category) => total + category.itemCount, 0),
          blockers: unresolvedBlockers(selectedWallet.blockers, categories),
        });
      }}
      onRequestReset={() => {
        if (!inventory) return;
        setMessage(null);
        setResolved(new Set());
        setConfirmation('');
        setPending({ kind: 'reset', summary: buildResetSummary(inventory) });
      }}
      onToggleResolved={(id) => setResolved((current) => toggle(current, id))}
      onConfirmationChange={setConfirmation}
      onConfirm={() => void confirm()}
      onCancel={closePending}
    />
  );
}
