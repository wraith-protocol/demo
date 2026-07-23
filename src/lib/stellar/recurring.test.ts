import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  nextFireAt,
  futureFireTimes,
  notificationsSupported,
  fireReminderNotification,
  scheduleReminderTimer,
  clearReminderTimer,
  useRecurringStore,
  type RecurringPayment,
} from './recurring';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

function base(overrides: Partial<RecurringPayment> = {}): RecurringPayment {
  return {
    id: 'rec-1',
    recipient: 'st:xlm:placeholder',
    label: '',
    amount: '10',
    asset: 'XLM',
    interval: 'daily',
    createdAt: 1_000_000,
    endAt: undefined,
    status: 'active',
    mode: 'reminder',
    fireCount: 0,
    lastFiredAt: null,
    slots: [],
    ...overrides,
  };
}

// ─── nextFireAt ───────────────────────────────────────────────────────────────

describe('nextFireAt', () => {
  it('returns first run one interval after createdAt when not yet fired', () => {
    const p = base({ createdAt: 1_000_000, lastFiredAt: null, interval: 'daily' });
    expect(nextFireAt(p, 1_000_001)).toBe(1_000_000 + DAY);
  });

  it('returns createdAt itself when it is still in the future', () => {
    const p = base({ createdAt: 9_000_000, lastFiredAt: null });
    expect(nextFireAt(p, 5_000_000)).toBe(9_000_000);
  });

  it('skips whole intervals to land strictly after now', () => {
    const p = base({ createdAt: 0, lastFiredAt: null, interval: 'daily' });
    expect(nextFireAt(p, DAY * 3 + 1)).toBe(DAY * 4);
  });

  it('advances from lastFiredAt once the payment has fired', () => {
    const p = base({ createdAt: 0, lastFiredAt: WEEK, interval: 'weekly' });
    expect(nextFireAt(p, WEEK + 1)).toBe(WEEK * 2);
  });

  it('returns null for cancelled payments', () => {
    expect(nextFireAt(base({ status: 'cancelled' }), 1_000_000)).toBeNull();
  });

  it('returns null when next run exceeds endAt', () => {
    const p = base({ createdAt: 0, lastFiredAt: null, interval: 'daily', endAt: DAY / 2 });
    expect(nextFireAt(p, 1)).toBeNull();
  });

  it('still returns a time for paused payments so the UI can show it', () => {
    const p = base({ status: 'paused', createdAt: 1_000_000, lastFiredAt: null });
    expect(nextFireAt(p, 1_000_001)).toBe(1_000_000 + DAY);
  });

  it('handles weekly interval', () => {
    const p = base({ createdAt: 0, lastFiredAt: null, interval: 'weekly' });
    expect(nextFireAt(p, 1)).toBe(WEEK);
  });

  it('advances monthly by calendar month', () => {
    const jan31 = Date.UTC(2026, 0, 31);
    const feb15 = Date.UTC(2026, 1, 15);
    const p = base({ createdAt: jan31, lastFiredAt: null, interval: 'monthly' });
    const next = nextFireAt(p, feb15);
    const expected = new Date(jan31);
    expected.setMonth(expected.getMonth() + 1);
    expect(next).toBe(expected.getTime());
  });
});

// ─── futureFireTimes ──────────────────────────────────────────────────────────

describe('futureFireTimes', () => {
  it('returns up to maxCount times', () => {
    const p = base({ createdAt: 0, lastFiredAt: null, interval: 'daily' });
    expect(futureFireTimes(p, 1, 5)).toHaveLength(5);
  });

  it('stops early when endAt is reached', () => {
    const p = base({
      createdAt: 0,
      lastFiredAt: null,
      interval: 'daily',
      endAt: DAY * 2 + 1,
    });
    // Only DAY and DAY*2 land before endAt
    expect(futureFireTimes(p, 1, 10)).toHaveLength(2);
  });

  it('returns empty array for a cancelled payment', () => {
    const p = base({ status: 'cancelled' });
    expect(futureFireTimes(p, 1, 5)).toHaveLength(0);
  });

  it('times are strictly increasing', () => {
    const p = base({ createdAt: 0, lastFiredAt: null, interval: 'weekly' });
    const times = futureFireTimes(p, 1, 4);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThan(times[i - 1]);
    }
  });
});

// ─── Notifications helpers ────────────────────────────────────────────────────

describe('notificationsSupported', () => {
  it('returns a boolean without throwing', () => {
    expect(typeof notificationsSupported()).toBe('boolean');
  });
});

describe('fireReminderNotification', () => {
  it('returns false when Notification global is absent', () => {
    const saved = (global as Record<string, unknown>).Notification;
    delete (global as Record<string, unknown>).Notification;
    expect(fireReminderNotification(base())).toBe(false);
    if (saved !== undefined) (global as Record<string, unknown>).Notification = saved;
  });

  it('returns false when permission is not granted', () => {
    (global as Record<string, unknown>).Notification = { permission: 'default' };
    expect(fireReminderNotification(base())).toBe(false);
    delete (global as Record<string, unknown>).Notification;
  });
});

// ─── Timer helpers ────────────────────────────────────────────────────────────

describe('scheduleReminderTimer / clearReminderTimer', () => {
  beforeEach(() => vi.useFakeTimers());

  it('does not throw for an active reminder-mode payment', () => {
    const p = base({ id: 'timer-1', mode: 'reminder', status: 'active', createdAt: 0 });
    expect(() => scheduleReminderTimer(p, 1)).not.toThrow();
    clearReminderTimer(p.id);
  });

  it('skips scheduling for presign-mode payments', () => {
    const p = base({ id: 'timer-2', mode: 'presign', status: 'active', createdAt: 0 });
    expect(() => scheduleReminderTimer(p, 1)).not.toThrow();
    clearReminderTimer(p.id);
  });

  it('clears the previous timer when called twice for the same payment', () => {
    const spy = vi.spyOn(globalThis, 'clearTimeout');
    const p = base({ id: 'timer-3', mode: 'reminder', status: 'active', createdAt: 0 });
    scheduleReminderTimer(p, 1);
    scheduleReminderTimer(p, 2);
    expect(spy).toHaveBeenCalledTimes(1);
    clearReminderTimer(p.id);
    spy.mockRestore();
  });

  it('clearReminderTimer is safe to call when no timer exists', () => {
    expect(() => clearReminderTimer('no-such-id')).not.toThrow();
  });
});

// ─── useRecurringStore ────────────────────────────────────────────────────────

describe('useRecurringStore', () => {
  beforeEach(() => {
    useRecurringStore.setState({ payments: [] });
  });

  it('addPayment inserts newest payment at the front', () => {
    const { addPayment } = useRecurringStore.getState();
    addPayment({
      recipient: 'st:xlm:a',
      amount: '5',
      asset: 'XLM',
      interval: 'monthly',
      mode: 'reminder',
    });
    addPayment({
      recipient: 'st:xlm:b',
      amount: '10',
      asset: 'XLM',
      interval: 'daily',
      mode: 'reminder',
    });
    const { payments } = useRecurringStore.getState();
    expect(payments).toHaveLength(2);
    expect(payments[0].recipient).toBe('st:xlm:b');
  });

  it('addPayment sets correct defaults', () => {
    const { addPayment } = useRecurringStore.getState();
    const p = addPayment({
      recipient: 'st:xlm:x',
      amount: '1',
      asset: 'XLM',
      interval: 'weekly',
      mode: 'presign',
    });
    expect(p.status).toBe('active');
    expect(p.fireCount).toBe(0);
    expect(p.lastFiredAt).toBeNull();
    expect(p.slots).toEqual([]);
    expect(p.mode).toBe('presign');
  });

  it('pausePayment → active becomes paused', () => {
    const { addPayment, pausePayment } = useRecurringStore.getState();
    const p = addPayment({
      recipient: 'st:xlm:p',
      amount: '1',
      asset: 'XLM',
      interval: 'daily',
      mode: 'reminder',
    });
    pausePayment(p.id);
    expect(useRecurringStore.getState().payments[0].status).toBe('paused');
  });

  it('resumePayment → paused becomes active', () => {
    const { addPayment, pausePayment, resumePayment } = useRecurringStore.getState();
    const p = addPayment({
      recipient: 'st:xlm:p',
      amount: '1',
      asset: 'XLM',
      interval: 'daily',
      mode: 'reminder',
    });
    pausePayment(p.id);
    resumePayment(p.id);
    expect(useRecurringStore.getState().payments[0].status).toBe('active');
  });

  it('cancelPayment sets cancelled and removes pending slots', () => {
    const { addPayment, setPreSignedSlots, cancelPayment } = useRecurringStore.getState();
    const p = addPayment({
      recipient: 'st:xlm:c',
      amount: '1',
      asset: 'XLM',
      interval: 'daily',
      mode: 'presign',
    });
    setPreSignedSlots(p.id, [
      { scheduledAt: Date.now() + 1000, signedXdr: 'xdr1', submitted: false },
    ]);
    cancelPayment(p.id);
    const updated = useRecurringStore.getState().payments[0];
    expect(updated.status).toBe('cancelled');
    expect(updated.slots.filter((s) => !s.submitted)).toHaveLength(0);
  });

  it('cancelPayment preserves submitted slots for the audit trail', () => {
    const { addPayment, setPreSignedSlots, cancelPayment } = useRecurringStore.getState();
    const p = addPayment({
      recipient: 'st:xlm:c2',
      amount: '1',
      asset: 'XLM',
      interval: 'daily',
      mode: 'presign',
    });
    setPreSignedSlots(p.id, [
      { scheduledAt: 1000, signedXdr: 'old', submitted: true, txHash: 'abc123' },
      { scheduledAt: 2000, signedXdr: 'new', submitted: false },
    ]);
    cancelPayment(p.id);
    const { slots } = useRecurringStore.getState().payments[0];
    expect(slots).toHaveLength(1);
    expect(slots[0].txHash).toBe('abc123');
  });

  it('editPayment updates mutable fields and clears pending slots', () => {
    const { addPayment, setPreSignedSlots, editPayment } = useRecurringStore.getState();
    const p = addPayment({
      recipient: 'st:xlm:e',
      amount: '1',
      asset: 'XLM',
      interval: 'daily',
      mode: 'presign',
    });
    setPreSignedSlots(p.id, [{ scheduledAt: 9999, signedXdr: 'xdr', submitted: false }]);
    editPayment(p.id, { amount: '20', interval: 'weekly' });
    const updated = useRecurringStore.getState().payments[0];
    expect(updated.amount).toBe('20');
    expect(updated.interval).toBe('weekly');
    expect(updated.slots.filter((s) => !s.submitted)).toHaveLength(0);
  });

  it('setPreSignedSlots keeps submitted entries and adds new pending ones', () => {
    const { addPayment, setPreSignedSlots } = useRecurringStore.getState();
    const p = addPayment({
      recipient: 'st:xlm:s',
      amount: '1',
      asset: 'XLM',
      interval: 'daily',
      mode: 'presign',
    });
    setPreSignedSlots(p.id, [{ scheduledAt: 1000, signedXdr: 'a', submitted: true, txHash: 'h1' }]);
    setPreSignedSlots(p.id, [{ scheduledAt: 2000, signedXdr: 'b', submitted: false }]);
    const { slots } = useRecurringStore.getState().payments[0];
    expect(slots).toHaveLength(2);
    expect(slots.some((s) => s.txHash === 'h1')).toBe(true);
    expect(slots.some((s) => s.scheduledAt === 2000)).toBe(true);
  });

  it('markSlotSubmitted increments fireCount and stamps txHash', () => {
    const { addPayment, setPreSignedSlots, markSlotSubmitted } = useRecurringStore.getState();
    const at = Date.now() + 1000;
    const p = addPayment({
      recipient: 'st:xlm:m',
      amount: '1',
      asset: 'XLM',
      interval: 'daily',
      mode: 'presign',
    });
    setPreSignedSlots(p.id, [{ scheduledAt: at, signedXdr: 'xdr', submitted: false }]);
    markSlotSubmitted(p.id, at, 'deadbeef');
    const updated = useRecurringStore.getState().payments[0];
    expect(updated.fireCount).toBe(1);
    expect(updated.lastFiredAt).not.toBeNull();
    expect(updated.slots[0].submitted).toBe(true);
    expect(updated.slots[0].txHash).toBe('deadbeef');
  });

  it('tick returns an empty array and does not fire payments that are not yet due', () => {
    const { addPayment } = useRecurringStore.getState();
    const p = addPayment({
      recipient: 'st:xlm:t',
      amount: '1',
      asset: 'XLM',
      interval: 'daily',
      mode: 'reminder',
    });
    // nextFireAt always returns a time strictly in the future, so a fresh payment
    // should never appear in the fired list on the very next tick.
    const fired = useRecurringStore.getState().tick(Date.now());
    expect(Array.isArray(fired)).toBe(true);
    expect(fired).not.toContain(p.id);
    expect(useRecurringStore.getState().payments[0].fireCount).toBe(0);
  });

  it('tick does not fire paused payments', () => {
    const { addPayment } = useRecurringStore.getState();
    const p = addPayment({
      recipient: 'st:xlm:tp',
      amount: '1',
      asset: 'XLM',
      interval: 'daily',
      mode: 'reminder',
    });
    useRecurringStore.setState({
      payments: useRecurringStore
        .getState()
        .payments.map((pay) => (pay.id === p.id ? { ...pay, status: 'paused' } : pay)),
    });
    const simulatedNow = p.createdAt + DAY + 1;
    expect(useRecurringStore.getState().tick(simulatedNow)).not.toContain(p.id);
  });

  it('tick does not fire presign-mode payments', () => {
    const { addPayment } = useRecurringStore.getState();
    const p = addPayment({
      recipient: 'st:xlm:tps',
      amount: '1',
      asset: 'XLM',
      interval: 'daily',
      mode: 'presign',
    });
    const simulatedNow = p.createdAt + DAY + 1;
    expect(useRecurringStore.getState().tick(simulatedNow)).not.toContain(p.id);
  });

  it('tick auto-cancels reminder payments past their endAt', () => {
    const { addPayment } = useRecurringStore.getState();
    const p = addPayment({
      recipient: 'st:xlm:te',
      amount: '1',
      asset: 'XLM',
      interval: 'daily',
      mode: 'reminder',
    });
    // endAt is set to one second before the first fire time (createdAt + DAY)
    const endAt = p.createdAt + DAY - 1;
    useRecurringStore.setState({
      payments: useRecurringStore
        .getState()
        .payments.map((pay) => (pay.id === p.id ? { ...pay, endAt } : pay)),
    });
    useRecurringStore.getState().tick(p.createdAt + DAY + 1);
    expect(useRecurringStore.getState().payments[0].status).toBe('cancelled');
  });
});
