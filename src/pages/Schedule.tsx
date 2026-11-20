import { useEffect, useMemo, useState } from 'react';
import { useScheduleStore, type CreateScheduleInput } from '@/stores/scheduleStore';
import { nextRunAt, type Schedule, type ScheduleInterval } from '@/lib/schedule';

const INTERVALS: ScheduleInterval[] = ['daily', 'weekly', 'monthly'];
const ASSETS = ['XLM', 'USDC'];
const TICK_INTERVAL_MS = 30_000;

export default function SchedulePage() {
  const schedules = useScheduleStore((s) => s.schedules);
  const addSchedule = useScheduleStore((s) => s.addSchedule);
  const pauseSchedule = useScheduleStore((s) => s.pauseSchedule);
  const resumeSchedule = useScheduleStore((s) => s.resumeSchedule);
  const cancelSchedule = useScheduleStore((s) => s.cancelSchedule);
  const tick = useScheduleStore((s) => s.tick);

  // The mock executor advances any active schedule whose next-run time has
  // elapsed. The production path is Spectre's scheduled-payments API; this
  // ticker stands in so the demo behaves like the real flow without
  // requiring an on-chain transaction every interval. Coarse on purpose:
  // the UI shows minute-level granularity at best.
  useEffect(() => {
    tick(Date.now());
    const id = setInterval(() => tick(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [tick]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Schedule
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Recurring stealth payments. Set up a recipient, amount, and interval, and the demo will
          tick the schedule forward locally. Production would route through Spectre&apos;s scheduled
          payments.
        </p>
      </header>

      <CreateScheduleForm onSubmit={addSchedule} />

      <ScheduleList
        schedules={schedules}
        onPause={pauseSchedule}
        onResume={resumeSchedule}
        onCancel={cancelSchedule}
      />
    </div>
  );
}

function CreateScheduleForm({ onSubmit }: { onSubmit: (input: CreateScheduleInput) => void }) {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [asset, setAsset] = useState(ASSETS[0]);
  const [interval, setInterval] = useState<ScheduleInterval>('daily');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!recipient.trim()) {
      setError('Recipient is required.');
      return;
    }
    const trimmedAmount = amount.trim();
    if (!trimmedAmount || Number(trimmedAmount) <= 0) {
      setError('Amount must be greater than zero.');
      return;
    }
    let endAt: number | undefined;
    if (endDate) {
      const parsed = Date.parse(endDate);
      if (Number.isNaN(parsed)) {
        setError('End date is not a valid date.');
        return;
      }
      endAt = parsed;
    }
    setError('');
    onSubmit({
      recipient: recipient.trim(),
      amount: trimmedAmount,
      asset,
      interval,
      endAt,
    });
    setRecipient('');
    setAmount('');
    setEndDate('');
  };

  return (
    <form
      onSubmit={submit}
      aria-labelledby="schedule-form-title"
      className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-5"
    >
      <h2
        id="schedule-form-title"
        className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface"
      >
        New schedule
      </h2>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="schedule-recipient"
          className="font-mono text-[10px] uppercase tracking-widest text-outline"
        >
          Recipient
        </label>
        <input
          id="schedule-recipient"
          type="text"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="st:xlm:..."
          className="h-12 w-full border border-outline-variant bg-surface px-4 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
        />
      </div>

      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <label
            htmlFor="schedule-amount"
            className="font-mono text-[10px] uppercase tracking-widest text-outline"
          >
            Amount
          </label>
          <input
            id="schedule-amount"
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            className="h-12 w-full border border-outline-variant bg-surface px-4 font-heading text-xl text-primary placeholder:text-outline focus:border-primary"
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:w-32">
          <label
            htmlFor="schedule-asset"
            className="font-mono text-[10px] uppercase tracking-widest text-outline"
          >
            Asset
          </label>
          <select
            id="schedule-asset"
            value={asset}
            onChange={(e) => setAsset(e.target.value)}
            className="h-12 w-full border border-outline-variant bg-surface px-3 font-mono text-sm text-primary focus:border-primary"
          >
            {ASSETS.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1.5">
          <label
            htmlFor="schedule-interval"
            className="font-mono text-[10px] uppercase tracking-widest text-outline"
          >
            Interval
          </label>
          <select
            id="schedule-interval"
            value={interval}
            onChange={(e) => setInterval(e.target.value as ScheduleInterval)}
            className="h-12 w-full border border-outline-variant bg-surface px-3 font-mono text-sm text-primary focus:border-primary"
          >
            {INTERVALS.map((it) => (
              <option key={it} value={it}>
                {it}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <label
            htmlFor="schedule-end"
            className="font-mono text-[10px] uppercase tracking-widest text-outline"
          >
            End date <span className="text-outline-variant">(optional)</span>
          </label>
          <input
            id="schedule-end"
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

      <button
        type="submit"
        className="h-12 w-full bg-primary font-heading text-[13px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110 disabled:opacity-30"
      >
        Add schedule
      </button>
    </form>
  );
}

function ScheduleList({
  schedules,
  onPause,
  onResume,
  onCancel,
}: {
  schedules: Schedule[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const visible = useMemo(() => schedules.filter((s) => s.status !== 'cancelled'), [schedules]);

  if (visible.length === 0) {
    return (
      <section className="flex flex-col gap-2 border border-dashed border-outline-variant bg-surface-container/40 p-6 text-center">
        <p className="font-mono text-[10px] uppercase tracking-widest text-outline">
          No active schedules
        </p>
        <p className="font-body text-xs text-on-surface-variant">
          Add one above and it will show here. Schedules persist across reloads.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3" data-testid="schedule-list">
      <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface">
        Active schedules
      </h2>
      {visible.map((schedule) => (
        <ScheduleRow
          key={schedule.id}
          schedule={schedule}
          onPause={onPause}
          onResume={onResume}
          onCancel={onCancel}
        />
      ))}
    </section>
  );
}

function ScheduleRow({
  schedule,
  onPause,
  onResume,
  onCancel,
}: {
  schedule: Schedule;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const next = nextRunAt(schedule, Date.now());
  const nextLabel =
    next === null
      ? '—'
      : new Date(next).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });

  return (
    <article
      data-testid="schedule-row"
      data-status={schedule.status}
      className="flex flex-col gap-3 border border-outline-variant bg-surface-container p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs text-primary">{schedule.recipient}</p>
          <p className="mt-0.5 font-heading text-lg font-semibold tracking-tight text-on-surface">
            {schedule.amount} {schedule.asset}
            <span className="ml-2 font-mono text-[10px] uppercase tracking-widest text-outline">
              {schedule.interval}
            </span>
          </p>
        </div>
        <StatusPill status={schedule.status} />
      </div>

      <dl className="grid grid-cols-2 gap-2 border-t border-outline-variant/30 pt-3">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-widest text-outline">Next run</dt>
          <dd className="font-mono text-xs text-on-surface" data-testid="next-run">
            {nextLabel}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-widest text-outline">
            Runs completed
          </dt>
          <dd className="font-mono text-xs text-on-surface" data-testid="run-count">
            {schedule.runCount}
          </dd>
        </div>
      </dl>

      <div className="flex gap-2">
        {schedule.status === 'active' && (
          <button
            type="button"
            onClick={() => onPause(schedule.id)}
            className="h-9 flex-1 border border-outline-variant font-heading text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
          >
            Pause
          </button>
        )}
        {schedule.status === 'paused' && (
          <button
            type="button"
            onClick={() => onResume(schedule.id)}
            className="h-9 flex-1 border border-outline-variant font-heading text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
          >
            Resume
          </button>
        )}
        <button
          type="button"
          onClick={() => onCancel(schedule.id)}
          className="h-9 flex-1 border border-error/40 font-heading text-[10px] uppercase tracking-widest text-error transition-colors hover:bg-error/10"
        >
          Cancel
        </button>
      </div>
    </article>
  );
}

const STATUS_PILL: Record<Schedule['status'], string> = {
  active: 'bg-tertiary/15 text-tertiary',
  paused: 'bg-outline/15 text-outline',
  cancelled: 'bg-surface-bright text-outline',
};

function StatusPill({ status }: { status: Schedule['status'] }) {
  return (
    <span
      data-testid={`status-${status}`}
      className={`inline-flex h-fit items-center px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest ${STATUS_PILL[status]}`}
    >
      {status}
    </span>
  );
}
