import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStellarWallet } from '@/context/StellarWalletContext';
import {
  useRecurringStore,
  nextFireAt,
  futureFireTimes,
  requestNotificationPermission,
  scheduleReminderTimer,
  clearReminderTimer,
  notificationsSupported,
  notificationPermission,
  type RecurringPayment,
  type RecurringInterval,
  type RecurringMode,
  type CreateRecurringInput,
  type PreSignedSlot,
} from '@/lib/stellar/recurring';
import { buildSendStellarAsset } from '@/lib/stellar/buildSendStellarAsset';
import { STELLAR_ASSETS, type StellarAssetKey } from '@/lib/stellar/assets';

// ─── Constants ────────────────────────────────────────────────────────────────

const INTERVALS: RecurringInterval[] = ['daily', 'weekly', 'monthly'];
const ASSET_KEYS: StellarAssetKey[] = STELLAR_ASSETS.map((a) => a.key as StellarAssetKey);
const TICK_INTERVAL_MS = 30_000;
// How many future slots to pre-sign at once (max)
const MAX_PRESIGN_SLOTS = 12;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StellarRecurringPage() {
  const { t } = useTranslation();
  const payments = useRecurringStore((s) => s.payments);
  const tick = useRecurringStore((s) => s.tick);
  const cancelPayment = useRecurringStore((s) => s.cancelPayment);
  const pausePayment = useRecurringStore((s) => s.pausePayment);
  const resumePayment = useRecurringStore((s) => s.resumePayment);

  const [editingId, setEditingId] = useState<string | null>(null);

  // Arm reminder timers for every active reminder-mode payment on mount.
  useEffect(() => {
    const now = Date.now();
    payments.forEach((p) => {
      if (p.status === 'active' && p.mode === 'reminder') {
        scheduleReminderTimer(p, now);
      }
    });
    return () => {
      payments.forEach((p) => clearReminderTimer(p.id));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Coarse tick so the "next fire" timestamps stay fresh in the UI.
  useEffect(() => {
    tick(Date.now());
    const id = setInterval(() => tick(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [tick]);

  const active = useMemo(() => payments.filter((p) => p.status !== 'cancelled'), [payments]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          {t('recurring.title')}
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          {t('recurring.description')}
        </p>
      </header>

      <NotificationBanner />

      {editingId ? (
        <EditPaymentForm
          payment={payments.find((p) => p.id === editingId)!}
          onDone={() => setEditingId(null)}
        />
      ) : (
        <CreatePaymentForm />
      )}

      <PaymentList
        payments={active}
        onEdit={(id) => setEditingId(id)}
        onPause={pausePayment}
        onResume={resumePayment}
        onCancel={cancelPayment}
      />
    </div>
  );
}

// ─── Notification permission banner ──────────────────────────────────────────

function NotificationBanner() {
  const { t } = useTranslation();
  const [permission, setPermission] = useState<NotificationPermission>(notificationPermission());
  const [dismissed, setDismissed] = useState(false);

  if (!notificationsSupported()) return null;
  if (permission === 'granted') return null;
  if (dismissed) return null;

  const request = async () => {
    const granted = await requestNotificationPermission();
    setPermission(granted ? 'granted' : 'denied');
  };

  return (
    <div
      role="status"
      className="flex items-start justify-between gap-4 border border-outline-variant bg-surface-container p-4"
    >
      <div className="flex flex-col gap-1">
        <p className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface">
          {t('recurring.notifBannerTitle')}
        </p>
        <p className="font-body text-xs text-on-surface-variant">
          {permission === 'denied'
            ? t('recurring.notifBannerDenied')
            : t('recurring.notifBannerPrompt')}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {permission !== 'denied' && (
          <button
            type="button"
            onClick={request}
            className="h-8 border border-primary px-3 font-heading text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-primary/10"
          >
            {t('recurring.notifEnable')}
          </button>
        )}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t('recurring.dismiss')}
          className="flex h-8 w-8 items-center justify-center text-outline transition-colors hover:text-on-surface-variant"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// ─── Create form ──────────────────────────────────────────────────────────────

function CreatePaymentForm() {
  const { t } = useTranslation();
  const addPayment = useRecurringStore((s) => s.addPayment);

  const handleSubmit = (input: CreateRecurringInput) => {
    const payment = addPayment(input);
    if (payment.mode === 'reminder') {
      scheduleReminderTimer(payment, Date.now());
    }
  };

  return <PaymentForm title={t('recurring.newPayment')} onSubmit={handleSubmit} />;
}

// ─── Edit form ────────────────────────────────────────────────────────────────

function EditPaymentForm({ payment, onDone }: { payment: RecurringPayment; onDone: () => void }) {
  const { t } = useTranslation();
  const editPayment = useRecurringStore((s) => s.editPayment);

  const handleSubmit = (input: CreateRecurringInput) => {
    editPayment(payment.id, {
      label: input.label,
      amount: input.amount,
      interval: input.interval,
      endAt: input.endAt,
    });
    onDone();
  };

  return (
    <PaymentForm
      title={t('recurring.editPayment')}
      initial={payment}
      onSubmit={handleSubmit}
      onCancel={onDone}
    />
  );
}

// ─── Shared form ──────────────────────────────────────────────────────────────

interface PaymentFormProps {
  title: string;
  initial?: RecurringPayment;
  onSubmit: (input: CreateRecurringInput) => void;
  onCancel?: () => void;
}

function PaymentForm({ title, initial, onSubmit, onCancel }: PaymentFormProps) {
  const { t } = useTranslation();
  const { address, signTransaction } = useStellarWallet();

  const [recipient, setRecipient] = useState(initial?.recipient ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [amount, setAmount] = useState(initial?.amount ?? '');
  const [asset, setAsset] = useState<StellarAssetKey>((initial?.asset as StellarAssetKey) ?? 'XLM');
  const [interval, setInterval] = useState<RecurringInterval>(initial?.interval ?? 'monthly');
  const [endDate, setEndDate] = useState(
    initial?.endAt ? new Date(initial.endAt).toISOString().slice(0, 10) : '',
  );
  const [mode, setMode] = useState<RecurringMode>(initial?.mode ?? 'reminder');
  const [presignWarningAck, setPresignWarningAck] = useState(false);
  const [error, setError] = useState('');
  const [presigning, setPresigning] = useState(false);

  const isEdit = !!initial;

  const validate = (): CreateRecurringInput | null => {
    if (!recipient.trim()) {
      setError(t('recurring.errorRecipient'));
      return null;
    }
    if (!recipient.trim().startsWith('st:xlm:')) {
      setError(t('recurring.errorRecipientFormat'));
      return null;
    }
    const trimmedAmount = amount.trim();
    if (!trimmedAmount || Number(trimmedAmount) <= 0) {
      setError(t('recurring.errorAmount'));
      return null;
    }
    if (mode === 'presign' && !presignWarningAck) {
      setError(t('recurring.errorPresignAck'));
      return null;
    }
    let endAt: number | undefined;
    if (endDate) {
      const parsed = Date.parse(endDate);
      if (Number.isNaN(parsed)) {
        setError(t('recurring.errorEndDate'));
        return null;
      }
      endAt = parsed;
    }
    setError('');
    return {
      recipient: recipient.trim(),
      label: label.trim(),
      amount: trimmedAmount,
      asset,
      interval,
      endAt,
      mode,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = validate();
    if (!input) return;

    // For reminder mode (or edit), just submit straight away.
    if (input.mode === 'reminder' || isEdit) {
      onSubmit(input);
      return;
    }

    // Pre-sign mode: build + sign all future XDRs before saving.
    if (!address) {
      setError(t('recurring.errorWalletNotConnected'));
      return;
    }
    setPresigning(true);
    setError('');
    try {
      const now = Date.now();
      const draftPayment = {
        interval: input.interval,
        createdAt: now,
        lastFiredAt: null,
        endAt: input.endAt,
        status: 'active' as const,
      };
      const times = futureFireTimes(draftPayment, now, MAX_PRESIGN_SLOTS);
      if (times.length === 0) {
        setError(t('recurring.errorNoFutureTimes'));
        setPresigning(false);
        return;
      }

      const slots: PreSignedSlot[] = [];
      for (const scheduledAt of times) {
        const result = await buildSendStellarAsset({
          senderAddress: address,
          recipientMetaAddress: input.recipient,
          amount: input.amount,
          assetKey: input.asset as StellarAssetKey,
        });
        const signedXdr = await signTransaction(result.transactionXdr);
        slots.push({ scheduledAt, signedXdr, submitted: false });
      }

      // addPayment is called by onSubmit; slots are attached via setPreSignedSlots
      // in PreSignFlow. Here we pass slots as extra metadata through a wrapper.
      (input as CreateRecurringInput & { _slots?: PreSignedSlot[] })._slots = slots;
      onSubmit(input);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('recurring.errorPresignFailed'));
    } finally {
      setPresigning(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      aria-labelledby="recurring-form-title"
      className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-5"
    >
      <h2
        id="recurring-form-title"
        className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface"
      >
        {title}
      </h2>

      {/* Mode selector — hidden in edit since mode cannot be changed */}
      {!isEdit && (
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            {t('recurring.mode')}
          </span>
          <div className="flex gap-0">
            {(['reminder', 'presign'] as RecurringMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 border py-2.5 font-heading text-[10px] uppercase tracking-widest transition-colors ${
                  mode === m
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-outline-variant text-outline hover:text-on-surface-variant'
                }`}
              >
                {t(`recurring.mode_${m}`)}
              </button>
            ))}
          </div>
          <p className="font-body text-xs text-on-surface-variant">
            {t(`recurring.modeDesc_${mode}`)}
          </p>
        </div>
      )}

      {/* Pre-sign risk warning */}
      {mode === 'presign' && !isEdit && (
        <div className="border border-error/40 bg-error/5 p-4">
          <p className="font-heading text-[10px] font-semibold uppercase tracking-widest text-error">
            {t('recurring.presignWarningTitle')}
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {(t('recurring.presignWarningItems', { returnObjects: true }) as string[]).map(
              (item, i) => (
                <li key={i} className="font-body text-xs text-on-surface-variant">
                  • {item}
                </li>
              ),
            )}
          </ul>
          <label className="mt-3 flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={presignWarningAck}
              onChange={(e) => setPresignWarningAck(e.target.checked)}
              className="h-4 w-4 accent-error"
            />
            <span className="font-body text-xs text-on-surface-variant">
              {t('recurring.presignWarningAck')}
            </span>
          </label>
        </div>
      )}

      {/* Recipient */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="rec-recipient"
          className="font-mono text-[10px] uppercase tracking-widest text-outline"
        >
          {t('recurring.recipient')}
        </label>
        <input
          id="rec-recipient"
          type="text"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          disabled={isEdit}
          placeholder="st:xlm:..."
          className="h-12 w-full border border-outline-variant bg-surface px-4 font-mono text-sm text-primary placeholder:text-outline focus:border-primary disabled:opacity-50"
        />
      </div>

      {/* Label */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="rec-label"
          className="font-mono text-[10px] uppercase tracking-widest text-outline"
        >
          {t('recurring.label')}{' '}
          <span className="text-outline-variant">({t('recurring.optional')})</span>
        </label>
        <input
          id="rec-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('recurring.labelPlaceholder')}
          className="h-12 w-full border border-outline-variant bg-surface px-4 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
        />
      </div>

      {/* Amount + Asset */}
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <label
            htmlFor="rec-amount"
            className="font-mono text-[10px] uppercase tracking-widest text-outline"
          >
            {t('recurring.amount')}
          </label>
          <input
            id="rec-amount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            className="h-12 w-full border border-outline-variant bg-surface px-4 font-heading text-xl text-primary placeholder:text-outline focus:border-primary"
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:w-28">
          <label
            htmlFor="rec-asset"
            className="font-mono text-[10px] uppercase tracking-widest text-outline"
          >
            {t('recurring.asset')}
          </label>
          <select
            id="rec-asset"
            value={asset}
            onChange={(e) => setAsset(e.target.value as StellarAssetKey)}
            disabled={isEdit}
            className="h-12 w-full border border-outline-variant bg-surface px-3 font-mono text-sm text-primary focus:border-primary disabled:opacity-50"
          >
            {ASSET_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Interval + End date */}
      <div className="flex flex-col gap-1.5 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1.5">
          <label
            htmlFor="rec-interval"
            className="font-mono text-[10px] uppercase tracking-widest text-outline"
          >
            {t('recurring.interval')}
          </label>
          <select
            id="rec-interval"
            value={interval}
            onChange={(e) => setInterval(e.target.value as RecurringInterval)}
            className="h-12 w-full border border-outline-variant bg-surface px-3 font-mono text-sm text-primary focus:border-primary"
          >
            {INTERVALS.map((iv) => (
              <option key={iv} value={iv}>
                {t(`recurring.interval_${iv}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <label
            htmlFor="rec-end"
            className="font-mono text-[10px] uppercase tracking-widest text-outline"
          >
            {t('recurring.endDate')}{' '}
            <span className="text-outline-variant">({t('recurring.optional')})</span>
          </label>
          <input
            id="rec-end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="h-12 w-full border border-outline-variant bg-surface px-3 font-mono text-sm text-primary focus:border-primary"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="h-12 flex-1 border border-outline-variant font-heading text-[13px] uppercase tracking-widest text-outline transition-colors hover:bg-surface-bright"
          >
            {t('recurring.cancel')}
          </button>
        )}
        <button
          type="submit"
          disabled={presigning || (mode === 'presign' && !isEdit && !presignWarningAck)}
          className="h-12 flex-1 bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
        >
          {presigning
            ? t('recurring.presigning')
            : isEdit
              ? t('recurring.saveChanges')
              : t('recurring.addPayment')}
        </button>
      </div>
    </form>
  );
}

// ─── Payment list ─────────────────────────────────────────────────────────────

function PaymentList({
  payments,
  onEdit,
  onPause,
  onResume,
  onCancel,
}: {
  payments: RecurringPayment[];
  onEdit: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const { t } = useTranslation();

  if (payments.length === 0) {
    return (
      <section className="flex flex-col gap-2 border border-dashed border-outline-variant bg-surface-container/40 p-6 text-center">
        <p className="font-mono text-[10px] uppercase tracking-widest text-outline">
          {t('recurring.emptyTitle')}
        </p>
        <p className="font-body text-xs text-on-surface-variant">{t('recurring.emptyBody')}</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3" data-testid="recurring-list">
      <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface">
        {t('recurring.activePayments')}
      </h2>
      {payments.map((p) => (
        <PaymentRow
          key={p.id}
          payment={p}
          onEdit={onEdit}
          onPause={onPause}
          onResume={onResume}
          onCancel={onCancel}
        />
      ))}
    </section>
  );
}

// ─── Payment row ──────────────────────────────────────────────────────────────

function PaymentRow({
  payment,
  onEdit,
  onPause,
  onResume,
  onCancel,
}: {
  payment: RecurringPayment;
  onEdit: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [showPresign, setShowPresign] = useState(false);

  const now = Date.now();
  const next = nextFireAt(payment, now);

  const nextLabel =
    next === null
      ? '—'
      : new Date(next).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });

  const pendingSlots = payment.slots.filter((s) => !s.submitted).length;

  return (
    <article
      data-testid="recurring-row"
      data-status={payment.status}
      data-mode={payment.mode}
      className="flex flex-col gap-3 border border-outline-variant bg-surface-container p-4"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {payment.label && (
            <p className="font-heading text-[10px] uppercase tracking-widest text-outline">
              {payment.label}
            </p>
          )}
          <p className="mt-0.5 font-heading text-lg font-semibold tracking-tight text-on-surface">
            {payment.amount} {payment.asset}
            <span className="ml-2 font-mono text-[10px] uppercase tracking-widest text-outline">
              {t(`recurring.interval_${payment.interval}`)}
            </span>
          </p>
          <p className="truncate font-mono text-xs text-primary">{payment.recipient}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusPill status={payment.status} />
          <ModePill mode={payment.mode} />
        </div>
      </div>

      {/* Stats */}
      <dl className="grid grid-cols-2 gap-2 border-t border-outline-variant/30 pt-3 sm:grid-cols-3">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-widest text-outline">
            {t('recurring.nextFire')}
          </dt>
          <dd className="font-mono text-xs text-on-surface" data-testid="next-fire">
            {nextLabel}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-widest text-outline">
            {t('recurring.fireCount')}
          </dt>
          <dd className="font-mono text-xs text-on-surface" data-testid="fire-count">
            {payment.fireCount}
          </dd>
        </div>
        {payment.mode === 'presign' && (
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-widest text-outline">
              {t('recurring.pendingSlots')}
            </dt>
            <dd className="font-mono text-xs text-on-surface" data-testid="pending-slots">
              {pendingSlots}
            </dd>
          </div>
        )}
      </dl>

      {/* Pre-sign panel toggle */}
      {payment.mode === 'presign' && (
        <button
          type="button"
          onClick={() => setShowPresign((v) => !v)}
          className="border border-outline-variant/50 py-1.5 font-heading text-[9px] uppercase tracking-widest text-outline transition-colors hover:text-on-surface-variant"
        >
          {showPresign ? t('recurring.hideSlots') : t('recurring.manageSlots')}
        </button>
      )}
      {showPresign && payment.mode === 'presign' && <PreSignPanel payment={payment} />}

      {/* Action buttons */}
      <div className="flex gap-2">
        {payment.status === 'active' && (
          <button
            type="button"
            onClick={() => onPause(payment.id)}
            className="h-9 flex-1 border border-outline-variant font-heading text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
          >
            {t('recurring.pause')}
          </button>
        )}
        {payment.status === 'paused' && (
          <button
            type="button"
            onClick={() => onResume(payment.id)}
            className="h-9 flex-1 border border-outline-variant font-heading text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
          >
            {t('recurring.resume')}
          </button>
        )}
        <button
          type="button"
          onClick={() => onEdit(payment.id)}
          className="h-9 flex-1 border border-outline-variant font-heading text-[10px] uppercase tracking-widest text-outline transition-colors hover:bg-surface-bright"
        >
          {t('recurring.edit')}
        </button>
        <button
          type="button"
          onClick={() => onCancel(payment.id)}
          className="h-9 flex-1 border border-error/40 font-heading text-[10px] uppercase tracking-widest text-error transition-colors hover:bg-error/10"
        >
          {t('recurring.cancelPayment')}
        </button>
      </div>
    </article>
  );
}

// ─── Pre-sign slot panel ──────────────────────────────────────────────────────

function PreSignPanel({ payment }: { payment: RecurringPayment }) {
  const { t } = useTranslation();
  const { address, signTransaction } = useStellarWallet();
  const setPreSignedSlots = useRecurringStore((s) => s.setPreSignedSlots);
  const markSlotSubmitted = useRecurringStore((s) => s.markSlotSubmitted);

  const [addingSlots, setAddingSlots] = useState(false);
  const [submitingAt, setSubmittingAt] = useState<number | null>(null);
  const [slotError, setSlotError] = useState('');

  const pending = payment.slots.filter((s) => !s.submitted);
  const submitted = payment.slots.filter((s) => s.submitted);

  const handleAddSlots = async () => {
    if (!address) {
      setSlotError(t('recurring.errorWalletNotConnected'));
      return;
    }
    setAddingSlots(true);
    setSlotError('');
    try {
      const now = Date.now();
      const times = futureFireTimes(payment, now, MAX_PRESIGN_SLOTS);
      const newSlots: PreSignedSlot[] = [];
      for (const scheduledAt of times) {
        const result = await buildSendStellarAsset({
          senderAddress: address,
          recipientMetaAddress: payment.recipient,
          amount: payment.amount,
          assetKey: payment.asset as StellarAssetKey,
        });
        const signedXdr = await signTransaction(result.transactionXdr);
        newSlots.push({ scheduledAt, signedXdr, submitted: false });
      }
      setPreSignedSlots(payment.id, newSlots);
    } catch (err: unknown) {
      setSlotError(err instanceof Error ? err.message : t('recurring.errorPresignFailed'));
    } finally {
      setAddingSlots(false);
    }
  };

  const handleSubmitSlot = async (slot: PreSignedSlot) => {
    setSubmittingAt(slot.scheduledAt);
    setSlotError('');
    try {
      const { STELLAR_NETWORK } = await import('@/config');
      const res = await fetch(`${STELLAR_NETWORK.horizonUrl}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `tx=${encodeURIComponent(slot.signedXdr)}`,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.extras?.result_codes?.transaction ?? t('recurring.errorSubmitFailed'),
        );
      }
      markSlotSubmitted(payment.id, slot.scheduledAt, data.hash ?? '');
    } catch (err: unknown) {
      setSlotError(err instanceof Error ? err.message : t('recurring.errorSubmitFailed'));
    } finally {
      setSubmittingAt(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 border border-outline-variant/30 bg-surface p-4">
      <div className="flex items-center justify-between">
        <p className="font-heading text-[10px] uppercase tracking-widest text-outline">
          {t('recurring.slotsTitle')}
        </p>
        <button
          type="button"
          onClick={handleAddSlots}
          disabled={addingSlots || !address}
          className="h-7 border border-outline-variant px-3 font-heading text-[9px] uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright disabled:opacity-30"
        >
          {addingSlots ? t('recurring.presigning') : t('recurring.addSlots')}
        </button>
      </div>

      {slotError && (
        <p role="alert" className="text-xs text-error">
          {slotError}
        </p>
      )}

      {pending.length === 0 && submitted.length === 0 && (
        <p className="font-body text-xs text-on-surface-variant">{t('recurring.noSlots')}</p>
      )}

      {pending.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-[9px] uppercase tracking-widest text-outline">
            {t('recurring.pendingSlotsLabel')} ({pending.length})
          </p>
          {pending.map((slot) => (
            <SlotRow
              key={slot.scheduledAt}
              slot={slot}
              submitting={submitingAt === slot.scheduledAt}
              onSubmit={() => handleSubmitSlot(slot)}
            />
          ))}
        </div>
      )}

      {submitted.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-[9px] uppercase tracking-widest text-outline">
            {t('recurring.submittedSlots')} ({submitted.length})
          </p>
          {submitted.map((slot) => (
            <SlotRow key={slot.scheduledAt} slot={slot} submitting={false} />
          ))}
        </div>
      )}
    </div>
  );
}

function SlotRow({
  slot,
  submitting,
  onSubmit,
}: {
  slot: PreSignedSlot;
  submitting: boolean;
  onSubmit?: () => void;
}) {
  const { t } = useTranslation();
  const dateLabel = new Date(slot.scheduledAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <div className="flex items-center justify-between gap-3 border border-outline-variant/20 bg-surface-container px-3 py-2">
      <div className="min-w-0">
        <p className="font-mono text-xs text-on-surface">{dateLabel}</p>
        {slot.txHash && (
          <p className="truncate font-mono text-[10px] text-outline">{slot.txHash}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {slot.submitted ? (
          <span className="font-mono text-[9px] uppercase tracking-widest text-tertiary">
            {t('recurring.slotSubmitted')}
          </span>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="h-7 border border-primary px-3 font-heading text-[9px] uppercase tracking-widest text-primary transition-colors hover:bg-primary/10 disabled:opacity-30"
          >
            {submitting ? t('recurring.submitting') : t('recurring.submitNow')}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Pills ────────────────────────────────────────────────────────────────────

const STATUS_PILL: Record<RecurringPayment['status'], string> = {
  active: 'bg-tertiary/15 text-tertiary',
  paused: 'bg-outline/15 text-outline',
  cancelled: 'bg-surface-bright text-outline',
};

function StatusPill({ status }: { status: RecurringPayment['status'] }) {
  const { t } = useTranslation();
  return (
    <span
      data-testid={`status-${status}`}
      className={`inline-flex h-fit items-center px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest ${STATUS_PILL[status]}`}
    >
      {t(`recurring.status_${status}`)}
    </span>
  );
}

function ModePill({ mode }: { mode: RecurringMode }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex h-fit items-center bg-surface-bright px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-outline">
      {t(`recurring.mode_${mode}`)}
    </span>
  );
}
