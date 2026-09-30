import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  actionableEntries,
  isTerminalStatus,
  MAX_OFFLINE_QUEUE_ITEMS,
  type OfflineConflictReason,
  type OfflineQueueEntry,
  type PaymentIntentPayload,
  type ScanSessionPayload,
  type SignedSubmitPayload,
} from '@/lib/offlineQueue';
import { useOfflineQueueStore } from '@/stores/offlineQueueStore';

const CONFLICT_COPY: Record<OfflineConflictReason, string> = {
  expired: 'This payment link expired before reconnect.',
  'invalid-recipient': 'The recipient address is no longer valid.',
  'unparseable-scan': 'This scan could not be read.',
  'stale-envelope':
    'This signed transaction is over 24h old — the account sequence likely moved on. Discard it and create a new one in Send.',
  'unsupported-chain': 'This chain is not supported for queued broadcast yet.',
};

function truncate(value: string, max = 28): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function describe(entry: OfflineQueueEntry): string {
  if (entry.kind === 'payment-intent') {
    const payload = entry.payload as PaymentIntentPayload;
    const asset = payload.asset ? ` ${payload.asset}` : '';
    return `Send ${payload.amount}${asset} to ${truncate(payload.recipient)}`;
  }
  if (entry.kind === 'scan-session') {
    const payload = entry.payload as ScanSessionPayload;
    return `QR scan (${payload.source})`;
  }
  const payload = entry.payload as SignedSubmitPayload;
  return `Signed transaction ${truncate(payload.txHash, 16)}`;
}

function intentLink(payload: PaymentIntentPayload): string | null {
  if (payload.chain !== 'stellar') return null;
  const params = new URLSearchParams({ to: payload.recipient });
  if (payload.amount) params.set('amount', payload.amount);
  if (payload.memo) params.set('memo', payload.memo);
  return `/send?${params.toString()}`;
}

function EntryActions({ entry }: { entry: OfflineQueueEntry }) {
  const navigate = useNavigate();
  const remove = useOfflineQueueStore((state) => state.remove);
  const broadcastSigned = useOfflineQueueStore((state) => state.broadcastSigned);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [broadcastError, setBroadcastError] = useState('');

  if (entry.kind === 'payment-intent') {
    const link = intentLink(entry.payload as PaymentIntentPayload);
    return (
      <div className="flex flex-wrap items-center gap-2">
        {link && (
          <button
            type="button"
            onClick={() => navigate(link)}
            className="h-9 border border-primary px-3 font-heading text-[11px] font-semibold uppercase tracking-widest text-primary"
          >
            Review in Send
          </button>
        )}
        <button
          type="button"
          onClick={() => remove(entry.id)}
          aria-label={`Discard queued item ${truncate(entry.id, 8)}`}
          className="h-9 px-3 font-heading text-[11px] font-semibold uppercase tracking-widest text-outline hover:text-on-surface"
        >
          Discard
        </button>
      </div>
    );
  }

  if (entry.kind === 'signed-submit') {
    if (entry.status !== 'needs-review') {
      return (
        <button
          type="button"
          onClick={() => remove(entry.id)}
          className="h-9 px-3 font-heading text-[11px] font-semibold uppercase tracking-widest text-outline hover:text-on-surface"
        >
          Discard
        </button>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            if (!confirming) {
              setConfirming(true);
              return;
            }
            setBusy(true);
            setBroadcastError('');
            const result = await broadcastSigned(entry.id);
            setBusy(false);
            setConfirming(false);
            if (!result.ok) setBroadcastError(result.error);
          }}
          className="h-9 bg-primary px-3 font-heading text-[11px] font-semibold uppercase tracking-widest text-surface disabled:opacity-50"
        >
          {busy ? 'Broadcasting…' : confirming ? 'Confirm broadcast' : 'Broadcast now'}
        </button>
        {!confirming && (
          <button
            type="button"
            onClick={() => remove(entry.id)}
            className="h-9 px-3 font-heading text-[11px] font-semibold uppercase tracking-widest text-outline hover:text-on-surface"
          >
            Discard
          </button>
        )}
        {broadcastError && (
          <p role="alert" className="w-full font-body text-xs text-error">
            {broadcastError}
          </p>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => remove(entry.id)}
      className="h-9 px-3 font-heading text-[11px] font-semibold uppercase tracking-widest text-outline hover:text-on-surface"
    >
      Discard
    </button>
  );
}

function StatusBadge({ entry }: { entry: OfflineQueueEntry }) {
  const labels: Record<OfflineQueueEntry['status'], string> = {
    queued: 'Queued',
    syncing: 'Syncing',
    'needs-review': 'Needs review',
    done: 'Done',
    conflict: 'Conflict',
    failed: 'Failed',
  };
  return (
    <span className="border border-outline-variant px-2 py-0.5 font-heading text-[10px] uppercase tracking-widest text-outline">
      {labels[entry.status]}
    </span>
  );
}

/**
 * Review surface for the explicit offline queue (Wave 9, issue #184).
 * Rendered on the Send page; hidden entirely when the queue is empty.
 * Signing-required work can only leave through the explicit
 * "Broadcast now" confirmation — never automatically.
 */
export function OfflineQueuePanel() {
  const entries = useOfflineQueueStore((state) => state.entries);
  const phase = useOfflineQueueStore((state) => state.phase);
  const clearResolved = useOfflineQueueStore((state) => state.clearResolved);

  if (entries.length === 0) return null;

  const actionable = actionableEntries(entries);
  const terminalCount = entries.filter((e) => isTerminalStatus(e.status)).length;
  const isFull = entries.length >= MAX_OFFLINE_QUEUE_ITEMS;

  return (
    <section
      aria-label="Offline queue"
      data-testid="offline-queue-panel"
      className="mt-6 border border-outline-variant bg-surface-container p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading text-xs font-bold uppercase tracking-widest text-on-surface">
          Offline queue
        </h2>
        {phase === 'reconciling' ? (
          <p role="status" className="font-body text-xs text-on-surface-variant">
            Reconciling…
          </p>
        ) : (
          actionable.length > 0 && (
            <p role="status" className="font-body text-xs text-on-surface-variant">
              {actionable.length} need{actionable.length === 1 ? 's' : ''} review
            </p>
          )
        )}
      </div>

      {isFull && (
        <p role="status" className="mt-2 font-body text-xs text-warning">
          Queue is full ({MAX_OFFLINE_QUEUE_ITEMS} items) — new offline work will be refused until
          you reconnect or discard items. Nothing is dropped silently.
        </p>
      )}

      <ul className="mt-3 space-y-3">
        {entries.map((entry) => {
          const reason = (entry.conflictReason ?? '') as OfflineConflictReason;
          return (
            <li
              key={entry.id}
              data-testid="offline-queue-entry"
              data-status={entry.status}
              data-kind={entry.kind}
              className="border border-outline-variant bg-surface p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-body text-sm text-on-surface">{describe(entry)}</p>
                <StatusBadge entry={entry} />
              </div>
              <p className="mt-1 font-body text-xs text-on-surface-variant">
                {entry.kind === 'signed-submit'
                  ? 'Signed while offline — broadcast only happens here, with your confirmation.'
                  : entry.kind === 'payment-intent'
                    ? 'Unsigned intent — review and sign in Send after reconnect.'
                    : 'Scan captured offline.'}
              </p>
              {entry.status === 'conflict' && (
                <p role="alert" className="mt-1 font-body text-xs text-error">
                  {CONFLICT_COPY[reason] ?? entry.lastError ?? 'Could not reconcile this item.'}
                  {entry.lastError && reason !== 'unparseable-scan' && reason !== 'expired'
                    ? ` (${entry.lastError})`
                    : ''}
                </p>
              )}
              {entry.status === 'failed' && entry.lastError && (
                <p role="alert" className="mt-1 font-body text-xs text-error">
                  {entry.lastError}
                </p>
              )}
              {(entry.status === 'needs-review' ||
                entry.status === 'conflict' ||
                entry.status === 'failed' ||
                entry.status === 'queued') && (
                <div className="mt-2">
                  <EntryActions entry={entry} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {terminalCount > 0 && (
        <button
          type="button"
          onClick={clearResolved}
          className="mt-3 h-9 px-3 font-heading text-[11px] font-semibold uppercase tracking-widest text-outline hover:text-on-surface"
        >
          Clear finished
        </button>
      )}
    </section>
  );
}
