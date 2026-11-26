import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import type {
  Announcement,
  MatchedAnnouncement,
  StealthKeys,
} from '@wraith-protocol/sdk/chains/stellar';
import { STELLAR_NETWORK } from '@/config';
import { getStellarContractId } from '@/lib/stellar/deployments';
import { trackEvent } from '@/lib/telemetry';
import { fetchAnnouncementsBestEffort } from '@/lib/stellar/receiveFallback';
import { readScanCursor, writeScanCursor, type RetentionGap } from '@/lib/stellar/scannerCursor';
import {
  isStellarBackgroundMessage,
  isStellarScannerMessage,
  type RecoverScanCursorCommand,
  type StellarScannerRequest,
} from '@/lib/stellar/scannerMessages';
import type { ScanStrategy } from '@/workers/stellarScanDispatch';
import type { WalletOperation, WalletSession } from '@/wallets/session';

type ScanAnnouncementsMock = (
  announcements: Announcement[],
  viewingKey: Uint8Array,
  spendingPubKey: Uint8Array,
  spendingScalar: bigint,
) => MatchedAnnouncement[];

function getScanAnnouncementsMock(): ScanAnnouncementsMock | undefined {
  const candidate = (window as Window & { scanAnnouncementsMock?: unknown }).scanAnnouncementsMock;
  return typeof candidate === 'function' ? (candidate as ScanAnnouncementsMock) : undefined;
}

interface UseStellarScannerOptions {
  stellarKeys: StealthKeys | null;
  address: string | null;
  strategy: ScanStrategy;
  t: TFunction;
  /** Guards the scan so a wallet transition drops results from a stale context. */
  session?: WalletSession;
}

export interface StellarScannerState {
  matched: MatchedAnnouncement[];
  isScanning: boolean;
  hasScanned: boolean;
  error: string;
  retentionGap: RetentionGap | null;
  scan: (recoveryStartLedger?: number) => Promise<void>;
  cancel: () => void;
  recoverRetentionGap: () => void;
}

export function useStellarScanner({
  stellarKeys,
  address,
  strategy,
  t,
  session,
}: UseStellarScannerOptions): StellarScannerState {
  const [matched, setMatched] = useState<MatchedAnnouncement[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [error, setError] = useState('');
  const [retentionGap, setRetentionGap] = useState<RetentionGap | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const operationRef = useRef<WalletOperation | null>(null);

  const terminateActiveWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const finishOperation = useCallback(() => {
    const operation = operationRef.current;
    if (!operation) return;
    session?.finish(operation);
    operationRef.current = null;
  }, [session]);

  const cancel = useCallback(() => {
    finishOperation();
    terminateActiveWorker();
    setIsScanning(false);
  }, [finishOperation, terminateActiveWorker]);

  useEffect(() => cancel, [cancel]);

  useEffect(() => {
    if (!session) return;
    return session.subscribe(() => {
      finishOperation();
      terminateActiveWorker();
      setIsScanning(false);
      setMatched([]);
      setHasScanned(false);
      setRetentionGap(null);
      setError('');
    });
  }, [finishOperation, session, terminateActiveWorker]);

  const scan = useCallback(
    async (recoveryStartLedger?: number) => {
      if (!stellarKeys) return;
      setIsScanning(true);
      setError('');

      let announcerContract: string;
      try {
        announcerContract = getStellarContractId('announcer');
      } catch (err) {
        cancel();
        setError(err instanceof Error ? err.message : t('common.scanFailed'));
        return;
      }

      const operation = session?.begin('stellar-scan-announcements') ?? null;
      operationRef.current = operation;
      const stale = () => operation !== null && !operation.active;

      const mockScan = getScanAnnouncementsMock();
      if (mockScan) {
        try {
          const announcements = await fetchAnnouncementsBestEffort(
            STELLAR_NETWORK.rpcUrl,
            announcerContract,
          );
          // A transition while the announcements were in flight must not hand a
          // stale inbox to the replacement wallet context.
          if (stale()) return;
          const results = mockScan(
            announcements,
            stellarKeys.viewingKey,
            stellarKeys.spendingPubKey,
            stellarKeys.spendingScalar,
          );
          if (stale()) return;
          setMatched(results);
          setHasScanned(true);
          trackEvent('scan_triggered');
        } catch (err) {
          if (!stale()) {
            setError(err instanceof Error ? err.message : t('common.scanFailed'));
          }
        } finally {
          finishOperation();
          setIsScanning(false);
        }
        return;
      }

      terminateActiveWorker();
      const worker = new Worker(new URL('../workers/stellar-scanner.worker.ts', import.meta.url), {
        type: 'module',
      });
      workerRef.current = worker;

      const finish = () => {
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        setIsScanning(false);
        finishOperation();
      };

      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (stale()) {
          finish();
          return;
        }
        const message = event.data;
        if (!isStellarScannerMessage(message)) {
          setError(t('common.scanFailed'));
          finish();
          return;
        }

        if (message.type === 'PAGE') {
          if (address && Number.isSafeInteger(message.committedLedger)) {
            writeScanCursor(localStorage, address, message.committedLedger + 1);
          }
          if (message.matched.length > 0) {
            setMatched((previous) => {
              const seen = new Set(previous.map((entry) => entry.stealthAddress));
              const fresh = message.matched.filter((entry) => !seen.has(entry.stealthAddress));
              return fresh.length > 0 ? [...previous, ...fresh] : previous;
            });
          }
          return;
        }

        if (message.type === 'SUCCESS') {
          setMatched(message.results);
          setHasScanned(true);
          setRetentionGap(null);
          if (address && Number.isSafeInteger(message.nextLedger)) {
            writeScanCursor(localStorage, address, message.nextLedger);
          }
          trackEvent('scan_triggered');
        } else if (message.type === 'RETENTION_GAP') {
          setRetentionGap({
            requestedLedger: message.requestedLedger,
            oldestAvailableLedger: message.oldestAvailableLedger,
          });
        } else {
          setError(message.error || t('common.scanFailed'));
        }
        finish();
      };

      worker.onerror = () => {
        setError(t('common.scanFailed'));
        finish();
      };

      const request: StellarScannerRequest = {
        rpcUrl: STELLAR_NETWORK.rpcUrl,
        announcerContract,
        viewingKey: stellarKeys.viewingKey,
        spendingPubKey: stellarKeys.spendingPubKey,
        spendingScalar: stellarKeys.spendingScalar,
        strategy,
        startLedger:
          recoveryStartLedger ?? (address ? readScanCursor(localStorage, address) : undefined),
      };
      worker.postMessage(request);
    },
    [address, cancel, finishOperation, session, stellarKeys, strategy, t, terminateActiveWorker],
  );

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handleMessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (!isStellarBackgroundMessage(message) || message.publicKey !== address) return;
      if (message.type === 'STELLAR_SCAN_RETENTION_GAP') {
        setRetentionGap({
          requestedLedger: message.requestedLedger,
          oldestAvailableLedger: message.oldestAvailableLedger,
        });
      } else {
        setRetentionGap(null);
      }
    };
    navigator.serviceWorker.addEventListener('message', handleMessage);
    return () => navigator.serviceWorker.removeEventListener('message', handleMessage);
  }, [address]);

  const recoverRetentionGap = useCallback(() => {
    if (!retentionGap) return;
    const command: RecoverScanCursorCommand = {
      type: 'RECOVER_SCAN_CURSOR',
      publicKey: address ?? undefined,
      oldestAvailableLedger: retentionGap.oldestAvailableLedger,
    };
    navigator.serviceWorker?.controller?.postMessage(command);
    void scan(retentionGap.oldestAvailableLedger);
  }, [address, retentionGap, scan]);

  return {
    matched,
    isScanning,
    hasScanned,
    error,
    retentionGap,
    scan,
    cancel,
    recoverRetentionGap,
  };
}
