export type ScheduleInterval = 'daily' | 'weekly' | 'monthly';

export type ScheduleStatus = 'active' | 'paused' | 'cancelled';

export interface Schedule {
  /** Stable id, generated client-side. */
  id: string;
  /** Stealth meta-address of the recipient (or a placeholder address for the demo). */
  recipient: string;
  /** Amount as the user typed it, kept as a string to avoid float quirks. */
  amount: string;
  /** Asset code, e.g. "XLM" or "USDC". */
  asset: string;
  interval: ScheduleInterval;
  /** Unix ms when this schedule was created. Anchors the recurrence. */
  createdAt: number;
  /** Optional Unix ms; the schedule stops firing once now passes this. */
  endAt?: number;
  status: ScheduleStatus;
  /** Number of mock executions recorded so far. */
  runCount: number;
  /** Unix ms of the last mock execution, or null if none yet. */
  lastRunAt: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/**
 * Returns the next time the schedule should fire, in Unix ms. The result is
 * derived purely from the schedule's fields and the supplied `now`, so the
 * function is trivially testable and deterministic. Returns `null` when the
 * schedule has been cancelled or has run past its `endAt`.
 *
 * - `paused` schedules still have a next-run timestamp; the UI uses it to
 *   show the resume point, but the executor skips them.
 * - `cancelled` schedules return `null`.
 * - Monthly cadence advances by calendar month using the local Date object so
 *   month-end edge cases (e.g. Jan 31 -> Feb 28) follow the platform's own
 *   rules rather than a hand-rolled approximation.
 */
export function nextRunAt(
  schedule: Pick<Schedule, 'interval' | 'createdAt' | 'lastRunAt' | 'endAt' | 'status'>,
  now: number,
): number | null {
  if (schedule.status === 'cancelled') return null;

  const anchor = schedule.lastRunAt ?? schedule.createdAt;
  let next: number;

  switch (schedule.interval) {
    case 'daily':
      next = advanceFixed(anchor, now, DAY_MS);
      break;
    case 'weekly':
      next = advanceFixed(anchor, now, WEEK_MS);
      break;
    case 'monthly':
      next = advanceMonthly(anchor, now);
      break;
  }

  if (schedule.endAt !== undefined && next > schedule.endAt) {
    return null;
  }
  return next;
}

function advanceFixed(anchor: number, now: number, stepMs: number): number {
  if (anchor > now) return anchor;
  const elapsed = now - anchor;
  const stepsToSkip = Math.floor(elapsed / stepMs) + 1;
  return anchor + stepsToSkip * stepMs;
}

function advanceMonthly(anchor: number, now: number): number {
  if (anchor > now) return anchor;
  const date = new Date(anchor);
  while (date.getTime() <= now) {
    date.setMonth(date.getMonth() + 1);
  }
  return date.getTime();
}
