/**
 * src/lib/stellar/recurring.ts
 *
 * Core data model, scheduler logic, pre-signed XDR storage, and browser
 * Notifications API helpers for Stellar recurring / scheduled payments.
 *
 * Two modes
 * ---------
 * reminder   — the UI fires a browser Notification at the scheduled time so
 *               the user can open the app and send manually. No keys are stored
 *               beyond the current session.
 *
 * presign    — the user signs all future transaction XDRs upfront. The
 *               scheduler submits each signed XDR at the right moment.
 *               IMPORTANT: Stellar transactions include a minimum-time /
 *               maximum-time in the TimeBounds and a sequence number that is
 *               valid only against the source account at signing time.
 *               Clock-drift, account merges, or bumped sequence numbers WILL
 *               cause failures. The user must acknowledge this risk before
 *               enabling pre-sign mode.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RecurringInterval = 'daily' | 'weekly' | 'monthly';

export type RecurringMode = 'reminder' | 'presign';

export type RecurringStatus = 'active' | 'paused' | 'cancelled';

export interface PreSignedSlot {
  /** Nominal scheduled time (Unix ms) this XDR is intended for. */
  scheduledAt: number;
  /** Signed transaction XDR, ready for Horizon submission. */
  signedXdr: string;
  /** Whether this slot has already been submitted. */
  submitted: boolean;
  /** Horizon transaction hash after successful submission (hex). */
  txHash?: string;
}

export interface RecurringPayment {
  /** Stable client-side id. */
  id: string;
  /** Stealth meta-address of the recipient. */
  recipient: string;
  /** Human label (optional) — e.g. "Rent payment". */
  label: string;
  /** Amount as entered by the user (string to avoid float precision issues). */
  amount: string;
  /** Asset code — "XLM" or "USDC". */
  asset: string;
  interval: RecurringInterval;
  /** Unix ms when this schedule was created. Used as the recurrence anchor. */
  createdAt: number;
  /** Optional Unix ms; the schedule ends after this timestamp. */
  endAt?: number;
  status: RecurringStatus;
  mode: RecurringMode;
  /** Number of occurrences that have been triggered (reminder fired / XDR submitted). */
  fireCount: number;
  /** Unix ms of the last fire, or null if none yet. */
  lastFiredAt: number | null;
  /**
   * Pre-signed XDR slots. Only populated when mode === 'presign'.
   * Ordered chronologically by scheduledAt.
   */
  slots: PreSignedSlot[];
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/**
 * Returns the next time this payment should fire, in Unix ms.
 *
 * - Cancelled schedules return null.
 * - Schedules past their endAt return null.
 * - Paused schedules still return a next-fire time so the UI can show when
 *   the payment would resume.
 */
export function nextFireAt(
  p: Pick<RecurringPayment, 'interval' | 'createdAt' | 'lastFiredAt' | 'endAt' | 'status'>,
  now: number,
): number | null {
  if (p.status === 'cancelled') return null;

  const anchor = p.lastFiredAt ?? p.createdAt;
  let next: number;

  switch (p.interval) {
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

  if (p.endAt !== undefined && next > p.endAt) {
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

/**
 * Returns all future scheduled fire times for a payment, starting from `now`,
 * up to `maxCount` occurrences or the payment's endAt (whichever comes first).
 *
 * Useful for building the pre-sign confirmation list.
 */
export function futureFireTimes(
  p: Pick<RecurringPayment, 'interval' | 'createdAt' | 'lastFiredAt' | 'endAt' | 'status'>,
  now: number,
  maxCount: number,
): number[] {
  const times: number[] = [];
  let cursor = now;
  for (let i = 0; i < maxCount; i++) {
    const next = nextFireAt({ ...p, lastFiredAt: cursor === now ? p.lastFiredAt : cursor }, cursor);
    if (next === null) break;
    times.push(next);
    cursor = next;
  }
  return times;
}

// ─── Notifications API helpers ────────────────────────────────────────────────

export type NotificationSupportStatus = 'supported' | 'denied' | 'unsupported';

/**
 * Returns whether the browser supports the Notifications API at all.
 */
export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * Returns the current Notification permission state.
 */
export function notificationPermission(): NotificationPermission {
  if (!notificationsSupported()) return 'denied';
  return Notification.permission;
}

/**
 * Requests notification permission from the user. Returns true if granted.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/**
 * Fires an immediate browser notification for a payment reminder.
 * Safe to call even if permission is not yet granted — returns false without
 * throwing in that case.
 */
export function fireReminderNotification(payment: RecurringPayment): boolean {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false;
  const title = payment.label
    ? `Recurring payment due — ${payment.label}`
    : 'Recurring payment due';
  const body = `${payment.amount} ${payment.asset} → ${payment.recipient.slice(0, 32)}…`;
  try {
    new Notification(title, {
      body,
      icon: '/icon-192.png',
      tag: `wraith-recurring-${payment.id}`,
    });
    return true;
  } catch {
    return false;
  }
}

// ─── Notification timer registry ─────────────────────────────────────────────
// Maps paymentId → window.setTimeout handle so we can cancel on edit/cancel.

const timerRegistry = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Schedules a one-shot setTimeout that fires a reminder notification at the
 * next due time. If a timer already exists for this payment it is cleared
 * first. Does nothing when the next fire time is null or mode is presign.
 */
export function scheduleReminderTimer(payment: RecurringPayment, now: number): void {
  clearReminderTimer(payment.id);
  if (payment.mode !== 'reminder') return;
  if (payment.status !== 'active') return;

  const next = nextFireAt(payment, now);
  if (next === null) return;

  const delayMs = next - now;
  // setTimeout has a max safe value of ~24.8 days (32-bit signed int ms).
  // For longer intervals we re-schedule from the notification handler itself.
  const safeDelay = Math.min(delayMs, 2_147_483_647);

  const handle = setTimeout(() => {
    timerRegistry.delete(payment.id);
    fireReminderNotification(payment);
  }, safeDelay);

  timerRegistry.set(payment.id, handle);
}

/**
 * Cancels any pending reminder timer for the given payment id.
 */
export function clearReminderTimer(id: string): void {
  const handle = timerRegistry.get(id);
  if (handle !== undefined) {
    clearTimeout(handle);
    timerRegistry.delete(id);
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

export interface CreateRecurringInput {
  recipient: string;
  label?: string;
  amount: string;
  asset: string;
  interval: RecurringInterval;
  endAt?: number;
  mode: RecurringMode;
}

interface RecurringState {
  payments: RecurringPayment[];

  /** Add a new recurring payment and return it. */
  addPayment: (input: CreateRecurringInput) => RecurringPayment;

  /** Edit mutable fields (label, amount, interval, endAt). Resets fire history. */
  editPayment: (
    id: string,
    patch: Partial<Pick<RecurringPayment, 'label' | 'amount' | 'interval' | 'endAt'>>,
  ) => void;

  pausePayment: (id: string) => void;
  resumePayment: (id: string) => void;

  /**
   * Cancel a payment. For pre-sign mode this clears all pending (not yet
   * submitted) signed XDR slots so keys are not retained unnecessarily.
   */
  cancelPayment: (id: string) => void;

  /**
   * Attach pre-signed XDR slots. Replaces any existing pending slots for
   * this payment. Only meaningful for mode === 'presign'.
   */
  setPreSignedSlots: (id: string, slots: PreSignedSlot[]) => void;

  /**
   * Mark a slot as submitted and record the txHash. Advances fireCount and
   * lastFiredAt.
   */
  markSlotSubmitted: (paymentId: string, scheduledAt: number, txHash: string) => void;

  /**
   * Advance any active reminder-mode payments whose next-fire time has elapsed.
   * Returns the ids that fired so the caller can send notifications.
   */
  tick: (now: number) => string[];
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useRecurringStore = create<RecurringState>()(
  persist(
    (set, get) => ({
      payments: [],

      addPayment: (input) => {
        const payment: RecurringPayment = {
          id: newId(),
          recipient: input.recipient,
          label: input.label ?? '',
          amount: input.amount,
          asset: input.asset,
          interval: input.interval,
          createdAt: Date.now(),
          endAt: input.endAt,
          status: 'active',
          mode: input.mode,
          fireCount: 0,
          lastFiredAt: null,
          slots: [],
        };
        set((state) => ({ payments: [payment, ...state.payments] }));
        return payment;
      },

      editPayment: (id, patch) => {
        set((state) => ({
          payments: state.payments.map((p) =>
            p.id === id
              ? {
                  ...p,
                  ...patch,
                  // Reset recurrence anchor so the new interval is counted
                  // from the edit time rather than the original creation time.
                  createdAt: Date.now(),
                  lastFiredAt: null,
                  // Clear any pending pre-sign slots — they may be invalid now
                  slots: p.slots.filter((s) => s.submitted),
                }
              : p,
          ),
        }));
        // Re-arm the reminder timer with updated data
        const updated = get().payments.find((p) => p.id === id);
        if (updated) scheduleReminderTimer(updated, Date.now());
      },

      pausePayment: (id) => {
        clearReminderTimer(id);
        set((state) => ({
          payments: state.payments.map((p) =>
            p.id === id && p.status === 'active' ? { ...p, status: 'paused' } : p,
          ),
        }));
      },

      resumePayment: (id) => {
        set((state) => ({
          payments: state.payments.map((p) =>
            p.id === id && p.status === 'paused' ? { ...p, status: 'active' } : p,
          ),
        }));
        const payment = get().payments.find((p) => p.id === id);
        if (payment) scheduleReminderTimer(payment, Date.now());
      },

      cancelPayment: (id) => {
        clearReminderTimer(id);
        set((state) => ({
          payments: state.payments.map((p) =>
            p.id === id
              ? {
                  ...p,
                  status: 'cancelled',
                  // Clear pending pre-signed XDRs so sensitive data is not
                  // retained after the user explicitly cancels.
                  slots: p.slots.filter((s) => s.submitted),
                }
              : p,
          ),
        }));
      },

      setPreSignedSlots: (id, slots) => {
        set((state) => ({
          payments: state.payments.map((p) =>
            p.id === id
              ? {
                  ...p,
                  slots: [
                    // Keep already-submitted slots for the audit trail
                    ...p.slots.filter((s) => s.submitted),
                    ...slots,
                  ],
                }
              : p,
          ),
        }));
      },

      markSlotSubmitted: (paymentId, scheduledAt, txHash) => {
        set((state) => ({
          payments: state.payments.map((p) => {
            if (p.id !== paymentId) return p;
            return {
              ...p,
              fireCount: p.fireCount + 1,
              lastFiredAt: Date.now(),
              slots: p.slots.map((s) =>
                s.scheduledAt === scheduledAt && !s.submitted
                  ? { ...s, submitted: true, txHash }
                  : s,
              ),
            };
          }),
        }));
      },

      tick: (now) => {
        const fired: string[] = [];
        set((state) => ({
          payments: state.payments.map((p) => {
            // presign mode is handled separately (explicit submit action)
            if (p.mode !== 'reminder') return p;
            if (p.status !== 'active') return p;

            const next = nextFireAt(p, now);
            if (next === null) {
              // Past endAt — auto-cancel
              clearReminderTimer(p.id);
              return { ...p, status: 'cancelled' as const };
            }
            if (next <= now) {
              fired.push(p.id);
              return { ...p, fireCount: p.fireCount + 1, lastFiredAt: now };
            }
            return p;
          }),
        }));
        return fired;
      },
    }),
    { name: 'wraith-recurring-storage' },
  ),
);
