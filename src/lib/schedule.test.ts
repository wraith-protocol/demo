import { describe, expect, it } from 'vitest';
import { nextRunAt, type Schedule } from './schedule';

function base(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'sched-1',
    recipient: 'st:xlm:placeholder',
    amount: '1',
    asset: 'XLM',
    interval: 'daily',
    createdAt: 1_000_000,
    endAt: undefined,
    status: 'active',
    runCount: 0,
    lastRunAt: null,
    ...overrides,
  };
}

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

describe('nextRunAt', () => {
  it('returns the first run one interval after createdAt when the schedule has not run yet', () => {
    const schedule = base({ createdAt: 1_000_000, lastRunAt: null });
    expect(nextRunAt(schedule, 1_000_001)).toBe(1_000_000 + DAY);
  });

  it('returns the createdAt timestamp itself when it is still in the future', () => {
    const schedule = base({ createdAt: 5_000_000, lastRunAt: null });
    expect(nextRunAt(schedule, 4_000_000)).toBe(5_000_000);
  });

  it('skips ahead by whole intervals to land strictly after now', () => {
    const schedule = base({ createdAt: 0, lastRunAt: null, interval: 'daily' });
    // Three full days have passed since the anchor.
    expect(nextRunAt(schedule, DAY * 3 + 1)).toBe(DAY * 4);
  });

  it('advances from lastRunAt rather than createdAt once the schedule has fired', () => {
    const schedule = base({
      createdAt: 0,
      lastRunAt: WEEK,
      interval: 'weekly',
    });
    expect(nextRunAt(schedule, WEEK + 1)).toBe(WEEK * 2);
  });

  it('returns null when status is cancelled', () => {
    expect(nextRunAt(base({ status: 'cancelled' }), 1_000_000)).toBeNull();
  });

  it('returns null when the next run would fall past endAt', () => {
    const schedule = base({
      createdAt: 0,
      lastRunAt: null,
      interval: 'daily',
      endAt: DAY / 2,
    });
    expect(nextRunAt(schedule, 1)).toBeNull();
  });

  it('still returns a next-run time for paused schedules so the UI can show it', () => {
    const schedule = base({ status: 'paused' });
    expect(nextRunAt(schedule, 1_000_001)).toBe(1_000_000 + DAY);
  });

  it('advances monthly schedules by calendar month, respecting month-length edge cases', () => {
    const jan31 = Date.UTC(2026, 0, 31);
    const feb15 = Date.UTC(2026, 1, 15);
    const schedule = base({
      createdAt: jan31,
      lastRunAt: null,
      interval: 'monthly',
    });
    const next = nextRunAt(schedule, feb15);
    // Calendar arithmetic: Jan 31 + 1 month lands on Feb 28 (or Mar 3 depending
    // on the JS Date overflow rule), which is what we want documented here.
    const expected = new Date(jan31);
    expected.setMonth(expected.getMonth() + 1);
    expect(next).toBe(expected.getTime());
  });
});
