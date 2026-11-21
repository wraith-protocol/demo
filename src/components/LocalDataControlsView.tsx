import { Link } from 'react-router-dom';
import {
  FULL_RESET_CONFIRMATION,
  type CategorySummary,
  type DeviceCategoryId,
  type LocalDataCategoryId,
  type ResetSummary,
  type TransactionBlocker,
  type WalletCategoryId,
  type WalletScope,
} from '@/lib/localData';

export interface LocalDataWalletOption {
  key: string;
  scope: WalletScope;
  connected: boolean;
  totalItems: number;
  categories: CategorySummary[];
}

export type LocalDataPendingAction =
  | { kind: 'delete-wallet'; scope: WalletScope; itemCount: number; blockers: TransactionBlocker[] }
  | { kind: 'reset'; summary: ResetSummary };

export interface LocalDataControlsViewProps {
  status: 'loading' | 'ready' | 'error';
  wallets: LocalDataWalletOption[];
  selectedWalletKey: string | null;
  selectedWalletCategories: ReadonlySet<WalletCategoryId>;
  device: CategorySummary[];
  selectedDeviceCategories: ReadonlySet<DeviceCategoryId>;
  pending: LocalDataPendingAction | null;
  resolvedBlockerIds: ReadonlySet<string>;
  confirmation: string;
  busy: boolean;
  message: { type: 'success' | 'error'; text: string } | null;
  onSelectWallet: (key: string) => void;
  onToggleWalletCategory: (id: WalletCategoryId) => void;
  onToggleDeviceCategory: (id: DeviceCategoryId) => void;
  onExportWallet: () => void;
  onExportDevice: () => void;
  onRequestDeleteWallet: () => void;
  onRequestReset: () => void;
  onToggleResolved: (id: string) => void;
  onConfirmationChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const BLOCKER_HINTS: Partial<Record<LocalDataCategoryId, { text: string; to: string }>> = {
  activity: { text: 'Check its status on the Activity page', to: '/activity' },
  'offline-intents': { text: 'Broadcast or discard it in the offline queue', to: '/send' },
  'pending-submissions': { text: 'Retry the send to confirm the outcome', to: '/send' },
  'unlinked-records': { text: 'Review the offline queue', to: '/send' },
  'auction-data': { text: 'Export a backup or reveal the bid', to: '/names/auctions' },
};

const buttonPrimary =
  'h-10 bg-primary px-4 font-heading text-xs font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30';
const buttonSecondary =
  'h-10 border border-outline-variant bg-surface px-4 font-heading text-xs font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-30';
const buttonDanger =
  'h-10 border border-error/40 bg-surface px-4 font-heading text-xs font-semibold uppercase tracking-widest text-error transition-colors hover:bg-error/10 disabled:opacity-30';

export function shortAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
}

export function scopeLabel(scope: WalletScope): string {
  return `${scope.chain} · ${scope.network} · ${shortAddress(scope.wallet)}`;
}

function CategoryList<T extends LocalDataCategoryId>({
  name,
  categories,
  selected,
  onToggle,
}: {
  name: string;
  categories: CategorySummary[];
  selected: ReadonlySet<T>;
  onToggle: (id: T) => void;
}) {
  return (
    <ul className="flex flex-col divide-y divide-outline-variant/60 border border-outline-variant">
      {categories.map((category) => {
        const id = category.id as T;
        const inputId = `${name}-${category.id}`;
        return (
          <li key={category.id} className="flex items-start gap-3 p-3">
            <input
              id={inputId}
              type="checkbox"
              className="mt-1 h-4 w-4 rounded-none accent-[var(--color-tertiary)]"
              checked={selected.has(id)}
              disabled={category.itemCount === 0}
              onChange={() => onToggle(id)}
            />
            <label htmlFor={inputId} className="flex flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2 font-heading text-sm font-semibold text-on-surface">
                {category.label}
                <span className="font-mono text-[10px] font-normal uppercase tracking-wider text-outline">
                  {category.itemCount} {category.itemCount === 1 ? 'item' : 'items'}
                </span>
                {category.exportMode === 'withheld' && (
                  <span className="font-mono text-[10px] font-normal uppercase tracking-wider text-outline">
                    · never exported
                  </span>
                )}
                {category.blockerCount > 0 && (
                  <span className="font-mono text-[10px] font-normal uppercase tracking-wider text-error">
                    · {category.blockerCount} open transaction
                    {category.blockerCount === 1 ? '' : 's'}
                  </span>
                )}
              </span>
              <span className="font-body text-xs text-on-surface-variant">
                {category.description}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function BlockerList({
  blockers,
  resolved,
  onToggle,
}: {
  blockers: TransactionBlocker[];
  resolved: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  if (blockers.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 border border-error/40 bg-error/10 p-3">
      <p className="font-body text-xs text-on-surface">
        These transactions are signed but not broadcast, or their outcome is unknown. Deleting their
        local records can lose the only copy needed to finish or verify them. Resolve each one
        first, or explicitly discard it.
      </p>
      <ul className="flex flex-col gap-2">
        {blockers.map((blocker) => {
          const hint = BLOCKER_HINTS[blocker.category];
          const inputId = `blocker-${blocker.id}`;
          return (
            <li key={blocker.id} className="flex items-start gap-3">
              <input
                id={inputId}
                type="checkbox"
                className="mt-1 h-4 w-4 rounded-none accent-[var(--color-error)]"
                checked={resolved.has(blocker.id)}
                onChange={() => onToggle(blocker.id)}
              />
              <label htmlFor={inputId} className="flex flex-col gap-1">
                <span className="font-mono text-xs text-on-surface">
                  <span className="uppercase text-error">[{blocker.kind}]</span> {blocker.summary}
                </span>
                <span className="font-body text-xs text-on-surface-variant">
                  Discard this local record. I have resolved it or accept losing it.
                  {hint && (
                    <>
                      {' '}
                      <Link to={hint.to} className="text-primary underline underline-offset-2">
                        {hint.text}
                      </Link>
                    </>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ResetSummaryView({ summary }: { summary: ResetSummary }) {
  return (
    <div className="flex flex-col gap-3 font-mono text-xs text-on-surface-variant">
      <p className="font-body text-sm text-on-surface">
        A full reset removes {summary.totalItems} item{summary.totalItems === 1 ? '' : 's'} from
        this device:
      </p>
      {summary.wallets.map((wallet) => (
        <div key={`${wallet.scope.chain}|${wallet.scope.network}|${wallet.scope.wallet}`}>
          <p className="text-on-surface">{scopeLabel(wallet.scope)}</p>
          <ul className="ml-4 list-disc">
            {wallet.categories.map((category) => (
              <li key={category.id}>
                {category.label}: {category.itemCount}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {summary.device.length > 0 && (
        <div>
          <p className="text-on-surface">Device-wide</p>
          <ul className="ml-4 list-disc">
            {summary.device.map((category) => (
              <li key={category.id}>
                {category.label}: {category.itemCount}
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary.caches.length > 0 && (
        <div>
          <p className="text-on-surface">Caches deleted</p>
          <ul className="ml-4 list-disc">
            {summary.caches.map((cache) => (
              <li key={cache.name}>
                {cache.name}: {cache.entries} cached response{cache.entries === 1 ? '' : 's'}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p className="text-on-surface">Kept</p>
        <ul className="ml-4 list-disc">
          {summary.kept.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function LocalDataControlsView(props: LocalDataControlsViewProps) {
  const {
    status,
    wallets,
    selectedWalletKey,
    selectedWalletCategories,
    device,
    selectedDeviceCategories,
    pending,
    resolvedBlockerIds,
    confirmation,
    busy,
    message,
  } = props;
  const wallet = wallets.find((option) => option.key === selectedWalletKey) ?? null;
  const pendingBlockers =
    pending?.kind === 'delete-wallet' ? pending.blockers : (pending?.summary.blockers ?? []);
  const allResolved = pendingBlockers.every((blocker) => resolvedBlockerIds.has(blocker.id));
  const canConfirm =
    !busy && allResolved && (pending?.kind !== 'reset' || confirmation === FULL_RESET_CONFIRMATION);

  return (
    <div className="flex flex-col gap-6" data-testid="local-data-controls">
      <p className="text-sm leading-relaxed text-on-surface-variant">
        Everything below is stored only in this browser. Export or delete it per wallet and network,
        or reset the app completely. Ordinary exports never include secrets or encrypted payloads;
        each export lists what it withheld and where to recover it.
      </p>

      {status === 'loading' && (
        <p className="font-mono text-xs text-outline">Reading local data…</p>
      )}
      {status === 'error' && (
        <p role="alert" className="font-mono text-xs text-error">
          Local data could not be read in this browser.
        </p>
      )}

      {status === 'ready' && (
        <>
          <fieldset className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-5">
            <legend className="font-mono text-[10px] uppercase tracking-widest text-on-surface">
              Wallet data
            </legend>
            {wallets.length === 0 ? (
              <p className="font-body text-xs text-on-surface-variant">
                No wallet-linked data is stored on this device.
              </p>
            ) : (
              <>
                <label className="flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                    Wallet and network
                  </span>
                  <select
                    value={selectedWalletKey ?? ''}
                    onChange={(event) => props.onSelectWallet(event.target.value)}
                    className="h-11 border border-outline-variant bg-surface px-3 font-mono text-sm text-primary"
                  >
                    {wallets.map((option) => (
                      <option key={option.key} value={option.key}>
                        {scopeLabel(option.scope)} ({option.totalItems})
                        {option.connected ? ' · connected' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {wallet && (
                  <>
                    <code className="break-all border border-outline-variant bg-surface p-2.5 font-mono text-xs text-primary">
                      {wallet.scope.wallet}
                    </code>
                    <CategoryList
                      name="wallet"
                      categories={wallet.categories}
                      selected={selectedWalletCategories}
                      onToggle={props.onToggleWalletCategory}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={buttonSecondary}
                        disabled={busy || selectedWalletCategories.size === 0}
                        onClick={props.onExportWallet}
                      >
                        Export selected
                      </button>
                      <button
                        type="button"
                        className={buttonDanger}
                        disabled={busy || selectedWalletCategories.size === 0}
                        onClick={props.onRequestDeleteWallet}
                      >
                        Delete selected
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-5">
            <legend className="font-mono text-[10px] uppercase tracking-widest text-on-surface">
              Device-wide data
            </legend>
            <p className="font-body text-xs text-on-surface-variant">
              Not linked to a single wallet, so it is never touched by a wallet deletion. A full
              reset removes it.
            </p>
            <CategoryList
              name="device"
              categories={device}
              selected={selectedDeviceCategories}
              onToggle={props.onToggleDeviceCategory}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonSecondary}
                disabled={busy || selectedDeviceCategories.size === 0}
                onClick={props.onExportDevice}
              >
                Export selected
              </button>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-4 border border-error/40 bg-surface-container p-5">
            <legend className="font-mono text-[10px] uppercase tracking-widest text-error">
              Full local reset
            </legend>
            <p className="font-body text-xs text-on-surface-variant">
              Removes every wallet&apos;s data and all device-wide data from this browser. You will
              see exactly what is removed before anything is deleted.
            </p>
            <div>
              <button
                type="button"
                className={buttonDanger}
                disabled={busy}
                onClick={props.onRequestReset}
              >
                Review full reset
              </button>
            </div>
          </fieldset>
        </>
      )}

      {pending && (
        <section
          role="dialog"
          aria-label={pending.kind === 'reset' ? 'Confirm full local reset' : 'Confirm deletion'}
          className="flex flex-col gap-4 border border-error/60 bg-surface-bright p-5"
        >
          <h3 className="font-heading text-sm font-semibold uppercase tracking-widest text-error">
            {pending.kind === 'reset' ? 'Confirm full local reset' : 'Confirm deletion'}
          </h3>
          {pending.kind === 'delete-wallet' ? (
            <p className="font-body text-sm text-on-surface">
              Delete {pending.itemCount} item{pending.itemCount === 1 ? '' : 's'} for{' '}
              <span className="font-mono">{scopeLabel(pending.scope)}</span>. Other wallets,
              networks and device-wide data are not touched.
            </p>
          ) : (
            <ResetSummaryView summary={pending.summary} />
          )}
          <BlockerList
            blockers={pendingBlockers}
            resolved={resolvedBlockerIds}
            onToggle={props.onToggleResolved}
          />
          {pending.kind === 'reset' && (
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Type {FULL_RESET_CONFIRMATION} to confirm
              </span>
              <input
                value={confirmation}
                onChange={(event) => props.onConfirmationChange(event.target.value)}
                autoComplete="off"
                className="h-11 border border-outline-variant bg-surface px-3.5 font-mono text-sm text-primary"
              />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonPrimary}
              disabled={!canConfirm}
              onClick={props.onConfirm}
            >
              {busy ? 'Deleting…' : pending.kind === 'reset' ? 'Reset everything' : 'Delete'}
            </button>
            <button
              type="button"
              className={buttonSecondary}
              disabled={busy}
              onClick={props.onCancel}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {message && (
        <p
          role={message.type === 'error' ? 'alert' : 'status'}
          className={`font-mono text-xs ${message.type === 'success' ? 'text-tertiary' : 'text-error'}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
