import { useTranslation } from 'react-i18next';
import { CopyButton } from '@/components/CopyButton';
import type { PendingChainSubmissionState } from '@/hooks/usePendingChainSubmission';

interface PendingSubmissionNoticeProps {
  pending: PendingChainSubmissionState;
  txUrl: (hash: string) => string;
}

function statusKey(pending: PendingChainSubmissionState): string {
  switch (pending.verdict?.state) {
    case 'replaced':
      return 'submission.statusReplaced';
    case 'unknown':
      return 'submission.statusUnknown';
    default:
      return pending.record?.status === 'submitting'
        ? 'submission.statusUnacknowledged'
        : 'submission.statusPending';
  }
}

/**
 * Shown while an earlier submission from this wallet has no authoritative
 * outcome. New sends stay disabled; the only actions are re-checking status
 * and an explicit "stop tracking" after the user reviewed it themselves.
 */
export function PendingSubmissionNotice({ pending, txUrl }: PendingSubmissionNoticeProps) {
  const { t } = useTranslation();
  const { record, foreignCount } = pending;
  if (!record && foreignCount === 0) return null;

  const needsReview = pending.verdict?.state === 'replaced';

  return (
    <div
      role="status"
      data-testid="pending-submission-notice"
      className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-5"
    >
      {record && (
        <>
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-1.5 w-1.5 ${needsReview ? 'bg-error' : 'animate-pulse bg-primary'}`}
            ></span>
            <span className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface">
              {t('submission.pendingTitle')}
            </span>
          </div>
          <p className="font-body text-sm leading-relaxed text-on-surface-variant">
            {t('submission.pendingBody')}
          </p>
          <div className="flex items-center justify-between gap-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
              {t('submission.status')}
            </span>
            <span
              data-testid="pending-submission-status"
              className={`font-mono text-[10px] ${needsReview ? 'text-error' : 'text-on-surface-variant'}`}
            >
              {t(statusKey(pending))}
            </span>
          </div>
          {record.txHash && (
            <div>
              <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
                {t('common.transactionHash')}
              </span>
              <div className="mt-0.5 flex items-center gap-2">
                <a
                  href={txUrl(record.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate font-mono text-xs text-primary underline"
                >
                  {record.txHash}
                </a>
                <CopyButton text={record.txHash} />
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => void pending.check()}
              disabled={pending.checking}
              className="h-11 flex-1 border border-outline-variant font-heading text-[13px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-30"
            >
              {pending.checking ? t('submission.checking') : t('submission.checkStatus')}
            </button>
            {needsReview && (
              <button
                onClick={() => void pending.discard()}
                className="h-11 flex-1 border border-error/50 font-heading text-[13px] font-semibold uppercase tracking-widest text-error transition-colors hover:bg-surface-bright"
              >
                {t('submission.stopTracking')}
              </button>
            )}
          </div>
        </>
      )}
      {foreignCount > 0 && (
        <p className="font-mono text-[10px] text-outline">
          {t('submission.foreignNotice', { count: foreignCount })}
        </p>
      )}
    </div>
  );
}
