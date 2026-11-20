import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nextRunAt, type Schedule, type ScheduleInterval } from '@/lib/schedule';

/**
 * Recurring payment schedules. Persisted to localStorage under
 * `wraith-schedule-storage` so a reload preserves the user's list. The
 * production path is Spectre's scheduled-payments API; the demo holds the
 * state client-side and ticks it from a setInterval in the page component.
 */
export interface CreateScheduleInput {
  recipient: string;
  amount: string;
  asset: string;
  interval: ScheduleInterval;
  endAt?: number;
}

interface ScheduleState {
  schedules: Schedule[];
  addSchedule: (input: CreateScheduleInput) => Schedule;
  pauseSchedule: (id: string) => void;
  resumeSchedule: (id: string) => void;
  cancelSchedule: (id: string) => void;
  /**
   * Advance any schedules whose next-run time has elapsed. Each tick
   * increments runCount and stamps lastRunAt to `now`. Returns the schedule
   * ids that fired so the caller can surface them.
   */
  tick: (now: number) => string[];
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useScheduleStore = create<ScheduleState>()(
  persist(
    (set, get) => ({
      schedules: [],
      addSchedule: (input) => {
        const schedule: Schedule = {
          id: newId(),
          recipient: input.recipient,
          amount: input.amount,
          asset: input.asset,
          interval: input.interval,
          createdAt: Date.now(),
          endAt: input.endAt,
          status: 'active',
          runCount: 0,
          lastRunAt: null,
        };
        set((state) => ({ schedules: [schedule, ...state.schedules] }));
        return schedule;
      },
      pauseSchedule: (id) =>
        set((state) => ({
          schedules: state.schedules.map((s) =>
            s.id === id && s.status === 'active' ? { ...s, status: 'paused' } : s,
          ),
        })),
      resumeSchedule: (id) =>
        set((state) => ({
          schedules: state.schedules.map((s) =>
            s.id === id && s.status === 'paused' ? { ...s, status: 'active' } : s,
          ),
        })),
      cancelSchedule: (id) =>
        set((state) => ({
          schedules: state.schedules.map((s) => (s.id === id ? { ...s, status: 'cancelled' } : s)),
        })),
      tick: (now) => {
        const fired: string[] = [];
        const schedules = get().schedules.map((s) => {
          if (s.status !== 'active') return s;
          const next = nextRunAt(s, now);
          if (next === null) {
            // Past endAt: drop to cancelled rather than leaving a live entry
            // whose nextRunAt is permanently null.
            return { ...s, status: 'cancelled' as const };
          }
          if (next <= now) {
            fired.push(s.id);
            return { ...s, runCount: s.runCount + 1, lastRunAt: now };
          }
          return s;
        });
        set({ schedules });
        return fired;
      },
    }),
    { name: 'wraith-schedule-storage' },
  ),
);
