/**
 * swUpdate.ts
 *
 * The update-prompt state machine, kept pure so the "a new version is ready"
 * flow can be tested without a browser or a service worker.
 *
 * Lifecycle:
 *   idle ──NEED_REFRESH──▶ waiting ──APPLY──▶ applying
 *                            │  ▲
 *                     DISMISS│  │NEED_REFRESH (a newer worker always re-prompts)
 *                            ▼  │
 *                        waiting(dismissed)
 *
 * Any `ERROR` moves the state to `error` so the UI can explain why the swap
 * failed instead of silently leaving the user on the old version.
 */

export type UpdateStatus = 'idle' | 'waiting' | 'applying' | 'error';

export interface UpdateState {
  status: UpdateStatus;
  /** The user chose "Later" for the currently waiting worker. */
  dismissed: boolean;
  error: string | null;
}

export const initialUpdateState: UpdateState = {
  status: 'idle',
  dismissed: false,
  error: null,
};

export type UpdateEvent =
  | { type: 'NEED_REFRESH' }
  | { type: 'APPLY' }
  | { type: 'DISMISS' }
  | { type: 'ERROR'; error: string };

export function reduceUpdateState(state: UpdateState, event: UpdateEvent): UpdateState {
  switch (event.type) {
    case 'NEED_REFRESH':
      // A waiting worker was found. No version comparison: a roll-back serves
      // different bytes, so the older build is announced just like a newer one.
      // While an apply is in flight, keep the current status and let the
      // controller-change reload finish.
      if (state.status === 'applying') return { ...state, error: null };
      return { status: 'waiting', dismissed: false, error: null };

    case 'APPLY':
      if (state.status === 'applying') return state;
      return { ...state, status: 'applying', error: null };

    case 'DISMISS':
      if (state.status !== 'waiting') return state;
      return { ...state, dismissed: true };

    case 'ERROR':
      return { ...state, status: 'error', error: event.error };

    default:
      return state;
  }
}

/** Whether the "new version ready" prompt should be visible right now. */
export function shouldPromptForUpdate(state: UpdateState): boolean {
  return state.status === 'waiting' && !state.dismissed;
}

/** Whether the update is being applied (controls the button's busy state). */
export function isApplyingUpdate(state: UpdateState): boolean {
  return state.status === 'applying';
}
