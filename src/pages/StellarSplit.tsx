import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { StellarLink } from '@/components/StellarLink';
import { trackEvent } from '@/lib/telemetry';
import { STELLAR_NETWORK } from '@/config';
import type { StellarAssetKey } from '@/lib/stellar/assets';
import type { BatchRow, BatchSendResult } from '@/lib/stellar/batchSend';
import { parseCsvRows, validateRows, sendBatch, MAX_BATCH_ROWS } from '@/lib/stellar/batchSend';

// ---------------------------------------------------------------------------
// CSV placeholder
// ---------------------------------------------------------------------------

const CSV_PLACEHOLDER = `# meta_address,amount,memo (memo optional)
st:xlm:AAAA...,10
st:xlm:BBBB...,5.5,payment-1
st:xlm:CCCC...,2`;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: BatchRow['status'] }) {
  switch (status) {
    case 'valid':
      return (
        <span className="inline-block h-1.5 w-1.5 bg-tertiary" title="Valid" aria-label="valid" />
      );
    case 'invalid':
      return (
        <span className="inline-block h-1.5 w-1.5 bg-error" title="Invalid" aria-label="invalid" />
      );
    case 'pending':
      return (
        <span
          className="inline-block h-1.5 w-1.5 animate-pulse bg-primary"
          title="Pending"
          aria-label="pending"
        />
      );
    case 'success':
      return (
        <span className="inline-block h-1.5 w-1.5 bg-tertiary" title="Sent" aria-label="sent" />
      );
    case 'failed':
      return (
        <span className="inline-block h-1.5 w-1.5 bg-error" title="Failed" aria-label="failed" />
      );
    default:
      return (
        <span
          className="inline-block h-1.5 w-1.5 bg-outline"
          title="Unvalidated"
          aria-label="unvalidated"
        />
      );
  }
}

function StatusLabel({ status }: { status: BatchRow['status'] }) {
  const labels: Record<BatchRow['status'], string> = {
    idle: '—',
    valid: 'OK',
    invalid: 'ERR',
    pending: '…',
    success: 'SENT',
    failed: 'FAIL',
  };
  const colors: Record<BatchRow['status'], string> = {
    idle: 'text-outline',
    valid: 'text-tertiary',
    invalid: 'text-error',
    pending: 'text-primary',
    success: 'text-tertiary',
    failed: 'text-error',
  };
  return (
    <span className={`font-mono text-[10px] uppercase tracking-widest ${colors[status]}`}>
      {labels[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Preview table
// ---------------------------------------------------------------------------

interface PreviewTableProps {
  rows: BatchRow[];
  assetKey: StellarAssetKey;
}

function PreviewTable({ rows, assetKey }: PreviewTableProps) {
  if (rows.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" aria-label="Batch recipients preview">
        <thead>
          <tr className="border-b border-outline-variant">
            <th className="py-2 pr-3 text-left font-mono text-[10px] uppercase tracking-widest text-outline">
              #
            </th>
            <th className="py-2 pr-3 text-left font-mono text-[10px] uppercase tracking-widest text-outline">
              Status
            </th>
            <th className="py-2 pr-3 text-left font-mono text-[10px] uppercase tracking-widest text-outline">
              Meta-Address
            </th>
            <th className="py-2 pr-3 text-left font-mono text-[10px] uppercase tracking-widest text-outline">
              Amount ({assetKey})
            </th>
            <th className="py-2 text-left font-mono text-[10px] uppercase tracking-widest text-outline">
              Error
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.index}
              className={[
                'border-b border-outline-variant/30',
                row.status === 'invalid' || row.status === 'failed'
                  ? 'bg-error/5'
                  : row.status === 'success'
                    ? 'bg-tertiary/5'
                    : '',
              ].join(' ')}
            >
              <td className="py-2 pr-3 font-mono text-xs text-outline">{row.index}</td>
              <td className="py-2 pr-3">
                <div className="flex items-center gap-1.5">
                  <StatusBadge status={row.status} />
                  <StatusLabel status={row.status} />
                </div>
              </td>
              <td className="py-2 pr-3">
                <span
                  className={[
                    'block max-w-[220px] truncate font-mono text-xs',
                    row.status === 'invalid' ? 'text-error' : 'text-primary',
                  ].join(' ')}
                  title={row.metaAddress}
                >
                  {row.metaAddress || <span className="text-outline italic">empty</span>}
                </span>
              </td>
              <td className="py-2 pr-3 font-mono text-xs text-on-surface-variant">
                {row.amountRaw || <span className="text-outline italic">—</span>}
              </td>
              <td className="py-2 font-mono text-xs text-error">{row.error || null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary counts
// ---------------------------------------------------------------------------

interface SummaryProps {
  rows: BatchRow[];
  assetKey: StellarAssetKey;
}

function Summary({ rows, assetKey }: SummaryProps) {
  const total = rows.length;
  const validCount = rows.filter((r) => r.status === 'valid').length;
  const invalidCount = rows.filter((r) => r.status === 'invalid').length;
  const successCount = rows.filter((r) => r.status === 'success').length;
  const failedCount = rows.filter((r) => r.status === 'failed').length;
  const totalAmount = rows
    .filter((r) => r.status === 'valid' || r.status === 'success' || r.status === 'pending')
    .reduce((acc, r) => acc + Number(r.amountRaw || 0), 0);

  return (
    <div className="flex flex-wrap gap-6">
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">Rows</span>
        <span className="font-heading text-base font-semibold text-on-surface">{total}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">Valid</span>
        <span className="font-heading text-base font-semibold text-tertiary">{validCount}</span>
      </div>
      {invalidCount > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Invalid
          </span>
          <span className="font-heading text-base font-semibold text-error">{invalidCount}</span>
        </div>
      )}
      {successCount > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">Sent</span>
          <span className="font-heading text-base font-semibold text-tertiary">{successCount}</span>
        </div>
      )}
      {failedCount > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Failed
          </span>
          <span className="font-heading text-base font-semibold text-error">{failedCount}</span>
        </div>
      )}
      {totalAmount > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Total {assetKey}
          </span>
          <span className="font-heading text-base font-semibold text-on-surface">
            {totalAmount.toFixed(7).replace(/\.?0+$/, '')}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const ASSET_KEY: StellarAssetKey = 'XLM';

export default function StellarSplit() {
  const { t } = useTranslation();
  const { address, isConnected, signTransaction } = useStellarWallet();

  // Phase: idle | validated | submitting | done
  type Phase = 'idle' | 'validated' | 'submitting' | 'done';
  const [phase, setPhase] = useState<Phase>('idle');

  const [csvText, setCsvText] = useState('');
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [error, setError] = useState('');
  const [result, setResult] = useState<BatchSendResult | null>(null);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const validCount = useMemo(() => rows.filter((r) => r.status === 'valid').length, [rows]);
  const invalidCount = useMemo(() => rows.filter((r) => r.status === 'invalid').length, [rows]);
  const hasRows = rows.length > 0;
  const canSubmit = isConnected && phase === 'validated' && validCount > 0 && invalidCount === 0;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setCsvText(text);
    } catch {
      // Clipboard denied — user can paste manually
    }
  }, []);

  const handleValidate = useCallback(() => {
    setError('');
    setResult(null);

    const parsed = parseCsvRows(csvText);
    if (parsed.length === 0) {
      setError('No rows found. Paste a CSV with at least one (meta_address, amount) row.');
      setRows([]);
      return;
    }
    if (parsed.length > MAX_BATCH_ROWS) {
      setError(`CSV exceeds the ${MAX_BATCH_ROWS}-row limit. Split into smaller batches.`);
    }

    const validated = validateRows(parsed, ASSET_KEY);
    setRows(validated);
    setPhase('validated');
    trackEvent('batch_validated');
  }, [csvText]);

  const handleSubmit = useCallback(async () => {
    if (!address) {
      setError(t('common.walletNotConnected'));
      return;
    }

    setError('');
    setPhase('submitting');

    // Snapshot the valid rows before async work
    const rowsSnapshot = [...rows];

    // Progress callback — update individual row statuses
    const handleProgress = (rowIndex: number, status: BatchRow['status'], errMsg?: string) => {
      setRows((prev) =>
        prev.map((r) =>
          r.index === rowIndex
            ? { ...r, status, error: errMsg ?? (status === 'failed' ? r.error : '') }
            : r,
        ),
      );
    };

    try {
      const batchResult = await sendBatch({
        senderAddress: address,
        rows: rowsSnapshot,
        assetKey: ASSET_KEY,
        signTransaction,
        onProgress: handleProgress,
      });

      setResult(batchResult);
      setPhase('done');
      trackEvent('batch_sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.transactionFailed'));
      setPhase('validated');
    }
  }, [address, rows, signTransaction, t]);

  const handleReset = useCallback(() => {
    setCsvText('');
    setRows([]);
    setError('');
    setResult(null);
    setPhase('idle');
  }, []);

  // Re-run validation whenever CSV text changes after a first validation
  useEffect(() => {
    if (phase === 'validated' || phase === 'done') {
      setPhase('idle');
      setRows([]);
      setResult(null);
    }
    // Intentionally only re-run when csvText changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvText]);

  // ---------------------------------------------------------------------------
  // Not connected
  // ---------------------------------------------------------------------------

  if (!isConnected) {
    return (
      <section className="flex flex-col gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          {t('stellar.network')}
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          {t('stellarSplit.title')}
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          {t('stellarSplit.connectPrompt')}
        </p>
      </section>
    );
  }

  // ---------------------------------------------------------------------------
  // Success state
  // ---------------------------------------------------------------------------

  if (phase === 'done' && result) {
    return (
      <section className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            {t('stellar.network')}
          </span>
          <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
            {t('stellarSplit.title')}
          </h1>
        </div>

        <div className="flex flex-col gap-5 border border-outline-variant bg-surface-container p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 bg-tertiary" />
            <span className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface">
              {t('common.transferComplete')}
            </span>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {t('stellarSplit.successCount')}
              </span>
              <p className="mt-0.5 font-heading text-lg font-semibold text-tertiary">
                {result.successCount} {t('stellarSplit.recipients')}
              </p>
            </div>

            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {t('common.transactionHash')}
              </span>
              <StellarLink
                value={result.horizonHash}
                type="tx"
                className="mt-0.5 max-w-full"
                linkClassName="text-xs"
              />
            </div>
          </div>

          {/* Row-level status table */}
          <PreviewTable rows={rows} assetKey={ASSET_KEY} />

          <button
            onClick={handleReset}
            className="h-11 w-full border border-outline-variant font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
          >
            {t('stellarSplit.newBatch')}
          </button>
        </div>
      </section>
    );
  }

  // ---------------------------------------------------------------------------
  // Main form
  // ---------------------------------------------------------------------------

  const isSubmitting = phase === 'submitting';

  return (
    <section className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
          {t('stellar.network')}
        </span>
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          {t('stellarSplit.title')}
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          {t('stellarSplit.description')}
        </p>
      </div>

      {/* CSV input */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <label
            htmlFor="csv-input"
            className="font-mono text-[10px] uppercase tracking-widest text-outline"
          >
            {t('stellarSplit.csvLabel')}
          </label>
          <button
            onClick={handlePaste}
            className="font-heading text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-primary"
            type="button"
          >
            {t('common.paste')}
          </button>
        </div>

        <textarea
          id="csv-input"
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder={CSV_PLACEHOLDER}
          rows={8}
          spellCheck={false}
          className="w-full border border-outline-variant bg-surface px-4 py-3 font-mono text-xs text-primary placeholder:text-outline/50 focus:border-primary focus:outline-none resize-y"
          aria-label={t('stellarSplit.csvLabel')}
          disabled={isSubmitting}
        />

        <p className="font-body text-xs text-on-surface-variant">
          {t('stellarSplit.csvHint', { max: MAX_BATCH_ROWS })}
        </p>
      </div>

      {/* Validate button */}
      {phase === 'idle' && (
        <button
          onClick={handleValidate}
          disabled={!csvText.trim()}
          className="h-12 w-full border border-outline-variant font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-30"
          type="button"
        >
          {t('stellarSplit.validate')}
        </button>
      )}

      {/* Validation error */}
      {error && !hasRows && (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      )}

      {/* Preview table + summary */}
      {hasRows && (
        <div className="flex flex-col gap-5">
          <Summary rows={rows} assetKey={ASSET_KEY} />
          <PreviewTable rows={rows} assetKey={ASSET_KEY} />
        </div>
      )}

      {/* All-or-nothing notice */}
      {hasRows && invalidCount === 0 && validCount > 0 && phase !== 'submitting' && (
        <p className="text-xs text-on-surface-variant border-l-2 border-outline-variant pl-3">
          {t('stellarSplit.allOrNothing')}
        </p>
      )}

      {/* Invalid rows notice */}
      {hasRows && invalidCount > 0 && (
        <p className="text-sm text-error" role="alert">
          {t('stellarSplit.fixErrors', { count: invalidCount })}
        </p>
      )}

      {/* Submit error */}
      {error && hasRows && (
        <p className="text-sm text-error" role="alert">
          {error}
        </p>
      )}

      {/* Action buttons */}
      {phase === 'validated' && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="h-12 flex-1 bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
            type="button"
          >
            {t('stellarSplit.sendBatch', { count: validCount })}
          </button>
          <button
            onClick={handleReset}
            className="h-12 flex-1 border border-outline-variant font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright sm:flex-none sm:w-28"
            type="button"
          >
            {t('stellarSplit.reset')}
          </button>
        </div>
      )}

      {/* Submitting state */}
      {phase === 'submitting' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 animate-pulse bg-primary" />
            <span className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface">
              {t('common.confirmInWallet')}
            </span>
          </div>
          <PreviewTable rows={rows} assetKey={ASSET_KEY} />
        </div>
      )}

      {/* Fee note */}
      {hasRows && validCount > 0 && (
        <div className="flex flex-col gap-1 border-t border-outline-variant/30 pt-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
              {t('common.networkFee')}
            </span>
            <span className="font-mono text-[10px] text-on-surface-variant">
              {validCount * 100} stroops ({validCount} ops × 100)
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
              {t('stellar.network')}
            </span>
            <span className="font-mono text-[10px] text-on-surface-variant">
              {STELLAR_NETWORK.name}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
