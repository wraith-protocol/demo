/**
 * Cross-tab coordination for the Stellar scanner.
 *
 * The lock name includes the wallet and network, so unrelated accounts never
 * block one another. Messages deliberately contain only public scan progress;
 * viewing keys and spending material never cross the tab boundary.
 */

export interface ScannerProgress {
  cursor?: number;
  matches?: Array<{ stealthAddress: string }>;
}

export interface ScannerLeaderOptions {
  walletAddress: string;
  network: string;
  channelFactory?: (name: string) => BroadcastChannel;
  locks?: LockManager;
  tabId?: string;
  waitMs?: number;
}

export interface ScannerLeaderRunOptions<T> {
  scan: (publish: (progress: ScannerProgress) => void) => Promise<T>;
  onProgress?: (progress: ScannerProgress) => void;
}

export type ScannerLeaderRunResult<T> =
  | { role: 'leader'; result: T }
  | { role: 'follower'; result?: undefined };

type WireMessage =
  | { type: 'started'; tabId: string }
  | { type: 'progress'; tabId: string; progress: ScannerProgress }
  | { type: 'finished'; tabId: string }
  | { type: 'failed'; tabId: string };

const DEFAULT_WAIT_MS = 15_000;

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isProgress(value: unknown): value is ScannerProgress {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as ScannerProgress;
  return (
    (candidate.cursor === undefined || Number.isSafeInteger(candidate.cursor)) &&
    (candidate.matches === undefined ||
      (Array.isArray(candidate.matches) &&
        candidate.matches.every(
          (match) => match && typeof match.stealthAddress === 'string',
        )))
  );
}

export function scannerLockName(walletAddress: string, network: string): string {
  return `wraith:stellar-scanner:${network}:${walletAddress}`;
}

/**
 * Runs one scan only when this tab owns the browser lock. If Locks are not
 * available, a short BroadcastChannel election chooses the lexicographically
 * smallest candidate. A missing channel/lock is treated as a coordination
 * failure and the scan runs locally, preserving availability when storage is
 * blocked (private browsing, embedded webviews, or disabled storage).
 */
export async function runAsScannerLeader<T>(
  options: ScannerLeaderOptions,
  runOptions: ScannerLeaderRunOptions<T>,
): Promise<ScannerLeaderRunResult<T>> {
  const tabId = options.tabId ?? makeId();
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  const lockName = scannerLockName(options.walletAddress, options.network);
  const channel = (() => {
    try {
      return options.channelFactory?.(lockName) ?? new BroadcastChannel(lockName);
    } catch {
      return undefined;
    }
  })();

  const publish = (progress: ScannerProgress) => {
    if (!isProgress(progress)) return;
    runOptions.onProgress?.(progress);
    channel?.postMessage({ type: 'progress', tabId, progress } satisfies WireMessage);
  };

  const run = async (): Promise<ScannerLeaderRunResult<T>> => {
    channel?.postMessage({ type: 'started', tabId } satisfies WireMessage);
    try {
      const result = await runOptions.scan(publish);
      channel?.postMessage({ type: 'finished', tabId } satisfies WireMessage);
      return { role: 'leader', result };
    } catch (error) {
      channel?.postMessage({ type: 'failed', tabId } satisfies WireMessage);
      throw error;
    } finally {
      channel?.close();
    }
  };

  if (options.locks) {
    let result: ScannerLeaderRunResult<T> | undefined;
    await options.locks.request(lockName, { ifAvailable: true }, async (lock) => {
      if (lock) result = await run();
    });
    if (result) return result;
    channel?.close();
    return { role: 'follower' };
  }

  if (!channel) return run();

  const candidates = new Set([tabId]);
  const onMessage = (event: MessageEvent<WireMessage>) => {
    const message = event.data;
    if (message?.type === 'started') candidates.add(message.tabId);
    if (message?.type === 'progress' && message.tabId !== tabId && isProgress(message.progress)) {
      runOptions.onProgress?.(message.progress);
    }
  };
  channel.addEventListener('message', onMessage);
  channel.postMessage({ type: 'started', tabId } satisfies WireMessage);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  channel.removeEventListener('message', onMessage);
  if (tabId === [...candidates].sort()[0]) return run();
  channel.close();
  return { role: 'follower' };
}
