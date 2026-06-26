import type { ReactNode } from 'react';
import { stellarTxUrl } from '@/lib/explorer';
import { CopyButton } from '@/components/CopyButton';
import { StellarPaymentLink } from '@/components/StellarPaymentLink';
import { ImportConflictModal } from '@/components/ImportConflictModal';
import type { ImportResult } from '@/lib/stealthLabels';

export interface StellarReceiveViewProps {
  isConnected: boolean;
  isDerivingKeys: boolean;
  keysDerived: boolean;
  metaAddress: string | null;
  vaultPanel?: ReactNode;
  registered: boolean;
  isRegistering: boolean;
  regHash: string | null;
  isScanning: boolean;
  hasScanned: boolean;
  matchCount: number;
  matches: ReactNode;
  error: string;
  retryStatus?: string;
  onDeriveKeys: () => void;
  onRegister: () => void;
  onScan: () => void;
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
  filteredMatchCount?: number;
  activeTag?: string | null;
  allTags?: string[];
  onTagClick?: (tag: string) => void;
  showHidden?: boolean;
  hiddenCount?: number;
  onToggleShowHidden?: () => void;
  onExport?: () => void;
  onImport?: () => void;
  importMessage?: string | null;
  importConflicts?: ImportResult['conflicts'] | null;
  onImportConflictResolve?: (action: 'keep-all' | 'overwrite-all') => void;
  onCloseImportModal?: () => void;
  // Notification props
  notificationsEnabled?: boolean;
  notificationsSupported?: boolean;
  notificationsPermission?: NotificationPermission;
  onToggleNotifications?: () => void;
  onFireTestNotification?: () => void;
}

export function StellarReceiveView({
  isConnected,
  isDerivingKeys,
  keysDerived,
  metaAddress,
  vaultPanel,
  registered,
  isRegistering,
  regHash,
  isScanning,
  hasScanned,
  matchCount,
  matches,
  error,
  retryStatus = '',
  onDeriveKeys,
  onRegister,
  onScan,
  searchQuery,
  onSearchChange,
  filteredMatchCount,
  activeTag,
  allTags,
  onTagClick,
  showHidden,
  hiddenCount,
  onToggleShowHidden,
  onExport,
  onImport,
  importMessage,
  importConflicts,
  onImportConflictResolve,
  onCloseImportModal,
  notificationsEnabled,
  notificationsSupported,
  notificationsPermission,
  onToggleNotifications,
  onFireTestNotification,
}: StellarReceiveViewProps) {
  if (!isConnected) {
    return (
      <section className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Stellar Testnet / XLM
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Receive
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Connect your Freighter wallet to scan for incoming stealth transfers on Stellar.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          Stellar Testnet / XLM
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Receive
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Derive your stealth keys, register on-chain, then scan for payments.
        </p>
      </div>

      {!keysDerived && (
        <div className="flex flex-col gap-4">
          <button
            onClick={onDeriveKeys}
            disabled={isDerivingKeys}
            className="h-12 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
          >
            {isDerivingKeys ? 'Sign in wallet...' : 'Derive Keys'}
          </button>
          {retryStatus && <p className="text-sm text-on-surface-variant">{retryStatus}</p>}
          {error && <p className="text-sm text-error">{error}</p>}
          {vaultPanel}
        </div>
      )}

      {keysDerived && metaAddress && (
        <>
          <div className="border border-outline-variant bg-surface-container p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                Your Stealth Meta-Address
              </span>
              <CopyButton text={metaAddress} />
            </div>
            <code className="block break-all font-mono text-xs leading-relaxed text-primary">
              {metaAddress}
            </code>
          </div>

          {vaultPanel}

          <div className="border border-outline-variant bg-surface-container p-5">
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
              On-Chain Registration
            </span>
            {registered ? (
              <div className="mt-3 flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
                <span className="font-mono text-xs text-on-surface-variant">
                  Meta-address registered on-chain
                  {regHash && (
                    <>
                      {' — '}
                      <a
                        href={stellarTxUrl(regHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline"
                      >
                        {regHash.slice(0, 14)}...
                      </a>
                    </>
                  )}
                </span>
              </div>
            ) : (
              <div className="mt-3">
                <p className="mb-3 font-body text-xs leading-relaxed text-on-surface-variant">
                  Register your meta-address so senders can look you up by wallet address.
                </p>
                <button
                  onClick={onRegister}
                  disabled={isRegistering}
                  className="h-11 w-full border border-outline-variant font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-30"
                >
                  {isRegistering ? 'Registering...' : 'Register On-Chain'}
                </button>
              </div>
            )}
          </div>

          <StellarPaymentLink metaAddress={metaAddress} />

          {/* Notification Settings */}
          {notificationsSupported && (
            <div className="border border-outline-variant bg-surface-container p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                  Background Notifications
                </span>
                <button
                  onClick={onToggleNotifications}
                  disabled={!notificationsSupported}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    notificationsEnabled ? 'bg-primary' : 'bg-outline-variant'
                  } disabled:opacity-30`}
                >
                  <span
                    className={`absolute top-1 h-4 w-4 rounded-full bg-surface transition-transform ${
                      notificationsEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              {notificationsEnabled ? (
                <div className="space-y-3">
                  <p className="font-body text-xs leading-relaxed text-on-surface-variant">
                    Receive notifications when new stealth payments are detected, even when the tab is closed.
                  </p>
                  <div className="rounded bg-surface-container-high p-3">
                    <p className="font-mono text-[9px] uppercase tracking-widest text-outline mb-2">
                      Privacy Disclosure
                    </p>
                    <p className="font-body text-[10px] leading-relaxed text-on-surface-variant">
                      Your viewing key is stored encrypted in IndexedDB using your wallet-derived key. 
                      The service worker periodically scans for new payments and shows notifications. 
                      You can disable this feature at any time.
                    </p>
                  </div>
                  {notificationsPermission === 'granted' && onFireTestNotification && (
                    <button
                      onClick={onFireTestNotification}
                      className="h-9 w-full border border-outline-variant font-mono text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
                    >
                      Test Notification
                    </button>
                  )}
                </div>
              ) : (
                <p className="font-body text-xs leading-relaxed text-on-surface-variant">
                  Enable notifications to receive alerts about incoming stealth payments even when the tab is closed.
                </p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              onClick={onScan}
              disabled={isScanning}
              className="h-12 bg-primary px-6 font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
            >
              {isScanning ? 'Scanning...' : 'Scan for Payments'}
            </button>
            {hasScanned && (
              <span className="font-mono text-xs text-on-surface-variant">
                {matchCount} transfer{matchCount !== 1 ? 's' : ''} found
              </span>
            )}
          </div>

          {retryStatus && <p className="text-sm text-on-surface-variant">{retryStatus}</p>}
          {error && <p className="text-sm text-error">{error}</p>}

          {/* Search, filter, and toolbar */}
          {hasScanned && matchCount > 0 && (
            <div className="flex flex-col gap-3">
              {onSearchChange && (
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-outline"
                    >
                      <circle cx="11" cy="11" r="8" />
                      <path d="m21 21-4.3-4.3" />
                    </svg>
                    <input
                      type="text"
                      value={searchQuery ?? ''}
                      onChange={(e) => onSearchChange(e.target.value)}
                      placeholder="Search by label, tag, or address..."
                      className="h-9 w-full border border-outline-variant bg-surface pl-8 pr-3 font-body text-xs text-on-surface placeholder:text-outline focus:border-primary"
                    />
                  </div>
                  {onExport && (
                    <button
                      onClick={onExport}
                      className="flex h-9 items-center gap-1.5 border border-outline-variant px-3 font-mono text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
                      title="Export labels"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Export
                    </button>
                  )}
                  {onImport && (
                    <button
                      onClick={onImport}
                      className="flex h-9 items-center gap-1.5 border border-outline-variant px-3 font-mono text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
                      title="Import labels"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      Import
                    </button>
                  )}
                </div>
              )}

              {importMessage && <p className="font-mono text-xs text-tertiary">{importMessage}</p>}

              {allTags && allTags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[9px] uppercase tracking-widest text-outline">
                    Tags:
                  </span>
                  {allTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => onTagClick?.(tag)}
                      className={`border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                        activeTag === tag
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-outline-variant/50 text-on-surface-variant hover:border-primary hover:text-primary'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                  {activeTag && (
                    <button
                      onClick={() => onTagClick?.(null as unknown as string)}
                      className="font-mono text-[10px] text-outline transition-colors hover:text-error"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}

              {hiddenCount != null && hiddenCount > 0 && onToggleShowHidden && (
                <button
                  onClick={onToggleShowHidden}
                  className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {showHidden ? (
                      <>
                        <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
                        <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
                        <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
                        <path d="m2 2 20 20" />
                      </>
                    ) : (
                      <>
                        <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
                        <circle cx="12" cy="12" r="3" />
                      </>
                    )}
                  </svg>
                  {showHidden ? `Hide archived (${hiddenCount})` : `Show hidden (${hiddenCount})`}
                </button>
              )}
            </div>
          )}

          {/* Matches */}
          {matchCount > 0 && <div className="flex flex-col gap-4">{matches}</div>}

          {hasScanned && matchCount > 0 && filteredMatchCount === 0 && (
            <div className="py-12 text-center">
              <p className="font-heading text-sm uppercase tracking-widest text-outline">
                No matching transfers
              </p>
              <p className="mt-2 font-body text-xs text-on-surface-variant">
                Try adjusting your search or filters.
              </p>
            </div>
          )}

          {hasScanned && matchCount === 0 && (
            <div className="py-12 text-center">
              <p className="font-heading text-sm uppercase tracking-widest text-outline">
                No transfers found
              </p>
              <p className="mt-2 font-body text-xs text-on-surface-variant">
                No stealth transfers matched your keys.
              </p>
            </div>
          )}

          {/* Import conflict modal */}
          {importConflicts && onImportConflictResolve && onCloseImportModal && (
            <ImportConflictModal
              conflicts={importConflicts}
              onResolve={onImportConflictResolve}
              onClose={onCloseImportModal}
            />
          )}
        </>
      )}
    </section>
  );
}
