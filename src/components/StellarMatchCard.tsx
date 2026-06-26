import { useState, useEffect, useRef } from 'react';
import { stellarTxUrl, stellarAddrUrl } from '@/lib/explorer';
import { CopyButton } from '@/components/CopyButton';
import { PrivacyTooltip } from '@/components/PrivacyTooltip';

export interface StellarMatchCardProps {
  stealthAddress: string;
  scalarHex: string;
  balance: string | null;
  balanceState: 'loading' | 'loaded' | 'error';
  dest: string;
  withdrawing: boolean;
  withdrawHash: string | null;
  feeBumpHash: string | null;
  error: string;
  retryStatus?: string;
  showKey: boolean;
  showSponsorPrompt: boolean;
  onDestChange: (value: string) => void;
  onWithdraw: () => void;
  onSponsoredWithdraw: () => void;
  onCancelSponsor: () => void;
  onRevealKey: () => void;
  labelData?: { label: string; tags: string[]; hiddenAt?: number } | null;
  onSaveLabel?: (label: string, tags: string[]) => void;
  onHide?: () => void;
  onUnhide?: () => void;
  onTagClick?: (tag: string) => void;
  showPrivacyWarning?: boolean;
  onDismissPrivacyWarning?: () => void;
}

export function StellarMatchCard({
  stealthAddress,
  scalarHex,
  balance,
  balanceState,
  dest,
  withdrawing,
  withdrawHash,
  feeBumpHash,
  error,
  retryStatus = '',
  showKey,
  showSponsorPrompt,
  onDestChange,
  onWithdraw,
  onSponsoredWithdraw,
  onCancelSponsor,
  onRevealKey,
  labelData,
  onSaveLabel,
  onHide,
  onUnhide,
  onTagClick,
  showPrivacyWarning,
  onDismissPrivacyWarning,
}: StellarMatchCardProps) {
  const hasBalance = balanceState === 'loaded' && balance != null && parseFloat(balance) > 0;
  const isHidden = !!labelData?.hiddenAt;
  const currentLabel = labelData?.label ?? '';
  const currentTags = labelData?.tags ?? [];

  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [editLabelValue, setEditLabelValue] = useState(currentLabel);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagValue, setNewTagValue] = useState('');
  const [showPrivacyBanner, setShowPrivacyBanner] = useState(false);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditLabelValue(currentLabel);
  }, [currentLabel]);

  useEffect(() => {
    if (isEditingLabel && labelInputRef.current) {
      labelInputRef.current.focus();
    }
  }, [isEditingLabel]);

  useEffect(() => {
    if (isAddingTag && tagInputRef.current) {
      tagInputRef.current.focus();
    }
  }, [isAddingTag]);

  const commitLabel = () => {
    if (!onSaveLabel) return;
    const trimmed = editLabelValue.trim().slice(0, 64);
    if (trimmed !== currentLabel) {
      if (showPrivacyWarning && !currentLabel) {
        setShowPrivacyBanner(true);
      }
      onSaveLabel(trimmed, currentTags);
    }
    setIsEditingLabel(false);
  };

  const addTag = () => {
    if (!onSaveLabel) return;
    const trimmed = newTagValue.trim().slice(0, 64);
    if (trimmed && !currentTags.includes(trimmed)) {
      const updatedTags = [...currentTags, trimmed];
      onSaveLabel(currentLabel, updatedTags);
    }
    setNewTagValue('');
    setIsAddingTag(false);
  };

  const removeTag = (tag: string) => {
    if (!onSaveLabel) return;
    const updatedTags = currentTags.filter((t) => t !== tag);
    onSaveLabel(currentLabel, updatedTags);
  };

  return (
    <div
      className={`flex flex-col gap-4 border border-outline-variant bg-surface-container p-5 ${isHidden ? 'opacity-50' : ''}`}
    >
      {/* Label section */}
      {onSaveLabel && (
        <div className="flex flex-col gap-2 border-t border-outline-variant/30 pt-4">
          <div className="flex items-center gap-2">
            {isEditingLabel ? (
              <input
                ref={labelInputRef}
                type="text"
                value={editLabelValue}
                onChange={(e) => setEditLabelValue(e.target.value.slice(0, 64))}
                onBlur={commitLabel}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitLabel();
                  if (e.key === 'Escape') {
                    setEditLabelValue(currentLabel);
                    setIsEditingLabel(false);
                  }
                }}
                placeholder="Add a label..."
                maxLength={64}
                className="h-7 flex-1 border border-outline-variant bg-surface px-2 font-body text-sm text-on-surface placeholder:text-outline focus:border-primary"
              />
            ) : (
              <div className="flex flex-1 items-center gap-2">
                {currentLabel ? (
                  <span className="font-body text-sm text-on-surface">{currentLabel}</span>
                ) : (
                  <span className="font-body text-xs italic text-outline">No label</span>
                )}
                <button
                  onClick={() => {
                    setEditLabelValue(currentLabel);
                    setIsEditingLabel(true);
                  }}
                  className="text-outline transition-colors hover:text-primary"
                  title="Edit label"
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
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    <path d="m15 5 4 4" />
                  </svg>
                </button>
              </div>
            )}

            {isHidden ? (
              onUnhide && (
                <button
                  onClick={onUnhide}
                  className="shrink-0 text-outline transition-colors hover:text-primary"
                  title="Unhide"
                >
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
                  >
                    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </button>
              )
            ) : (
              onHide && (
                <button
                  onClick={onHide}
                  className="shrink-0 text-outline transition-colors hover:text-primary"
                  title="Hide"
                >
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
                  >
                    <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
                    <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
                    <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
                    <path d="m2 2 20 20" />
                  </svg>
                </button>
              )
            )}
          </div>

          {/* Tags */}
          {(currentTags.length > 0 || !isHidden) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {currentTags.map((tag) => (
                <span
                  key={tag}
                  className="group flex items-center gap-1 border border-outline-variant/50 px-2 py-0.5"
                >
                  <button
                    onClick={() => onTagClick?.(tag)}
                    className="font-mono text-[10px] text-on-surface-variant transition-colors hover:text-primary"
                  >
                    {tag}
                  </button>
                  <button
                    onClick={() => removeTag(tag)}
                    className="text-outline opacity-0 transition-opacity hover:text-error group-hover:opacity-100"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                </span>
              ))}
              {!isHidden &&
                (isAddingTag ? (
                  <input
                    ref={tagInputRef}
                    type="text"
                    value={newTagValue}
                    onChange={(e) => setNewTagValue(e.target.value.slice(0, 64))}
                    onBlur={addTag}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addTag();
                      if (e.key === 'Escape') {
                        setNewTagValue('');
                        setIsAddingTag(false);
                      }
                    }}
                    placeholder="tag name"
                    maxLength={64}
                    className="h-5 w-20 border border-outline-variant bg-surface px-1 font-mono text-[10px] text-on-surface placeholder:text-outline focus:border-primary"
                  />
                ) : (
                  <button
                    onClick={() => setIsAddingTag(true)}
                    className="flex items-center gap-0.5 font-mono text-[10px] text-outline transition-colors hover:text-primary"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M5 12h14" />
                      <path d="M12 5v14" />
                    </svg>
                    tag
                  </button>
                ))}
            </div>
          )}

          {/* Privacy warning */}
          {showPrivacyBanner && onDismissPrivacyWarning && (
            <PrivacyTooltip
              onDismiss={() => {
                setShowPrivacyBanner(false);
                onDismissPrivacyWarning();
              }}
            />
          )}
        </div>
      )}

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Stealth Address
          </span>
          <div className="mt-0.5 flex items-center gap-2">
            <a
              href={stellarAddrUrl(stealthAddress)}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate font-mono text-xs text-primary underline"
            >
              {stealthAddress}
            </a>
            <CopyButton text={stealthAddress} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {balanceState === 'loading' ? (
            <span className="font-mono text-xs text-outline">...</span>
          ) : balanceState === 'error' ? (
            <span className="font-mono text-xs text-error">Balance error</span>
          ) : hasBalance ? (
            <>
              <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
              <span className="font-heading text-lg font-bold text-on-surface">{balance} XLM</span>
            </>
          ) : (
            <span className="font-mono text-xs text-outline">Empty</span>
          )}
        </div>
      </div>

      {!withdrawHash && hasBalance && (
        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Withdraw to
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={dest}
              onChange={(e) => onDestChange(e.target.value)}
              placeholder="Destination address (G...)"
              className="h-10 flex-1 border border-outline-variant bg-surface px-3 font-mono text-xs text-primary placeholder:text-outline focus:border-primary"
            />
            <button
              onClick={onWithdraw}
              disabled={!dest || withdrawing}
              className="h-10 bg-primary px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
            >
              {withdrawing ? '...' : 'Withdraw'}
            </button>
          </div>
        </div>
      )}

      {showSponsorPrompt && (
        <div className="border border-tertiary bg-tertiary/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
            <span className="font-heading text-xs font-semibold uppercase tracking-widest text-tertiary">
              Sponsored Withdrawal Required
            </span>
          </div>
          <p className="mb-3 font-body text-xs leading-relaxed text-on-surface-variant">
            This stealth address can't pay its own fees. Your connected wallet will sponsor the
            transaction and pay the fee. Freighter will prompt you to sign the fee-bump transaction.
          </p>
          <p className="mb-4 font-body text-xs leading-relaxed text-on-surface-variant">
            The entire balance (including base reserve) will be merged into the destination address.
          </p>
          <div className="flex gap-2">
            <button
              onClick={onSponsoredWithdraw}
              disabled={withdrawing}
              className="h-10 flex-1 bg-tertiary px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
            >
              {withdrawing ? 'Processing...' : 'Pay with Connected Wallet'}
            </button>
            <button
              onClick={onCancelSponsor}
              disabled={withdrawing}
              className="h-10 border border-outline-variant px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-outline transition-colors hover:bg-surface-bright disabled:opacity-30"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {retryStatus && <p className="text-xs text-on-surface-variant">{retryStatus}</p>}
      {error && <p className="text-xs text-error">{error}</p>}

      {withdrawHash && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 bg-tertiary"></span>
            <span className="font-mono text-[10px] text-on-surface-variant">
              {feeBumpHash ? 'Sponsored withdrawal complete' : 'Withdrawn'} —{' '}
              <a
                href={stellarTxUrl(withdrawHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                {withdrawHash.slice(0, 14)}...
              </a>
            </span>
          </div>
          {feeBumpHash && (
            <p className="font-body text-[10px] leading-relaxed text-on-surface-variant">
              Fee-bump transaction sponsored by your connected wallet. All funds including base
              reserve have been recovered.
            </p>
          )}
        </div>
      )}

      <div className="border-t border-outline-variant/30 pt-3">
        {!showKey ? (
          <button
            onClick={onRevealKey}
            className="font-mono text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
          >
            Reveal secret key
          </button>
        ) : (
          <div className="border border-error/20 bg-error/5 p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-[9px] font-semibold uppercase tracking-widest text-error">
                Stealth Key
              </span>
              <CopyButton text={scalarHex} />
            </div>
            <code className="break-all font-mono text-[11px] text-on-surface">{scalarHex}</code>
          </div>
        )}
      </div>
    </div>
  );
}
