import { useCallback, useEffect, useReducer, useRef } from 'react';
import { registerSW } from 'virtual:pwa-register';
import {
  initialUpdateState,
  isApplyingUpdate,
  reduceUpdateState,
  shouldPromptForUpdate,
} from '@/lib/swUpdate';

/**
 * Registration is intentionally not `skipWaiting`: the new worker stays in the
 * `waiting` state until the user accepts the update, so a deploy can never swap
 * the app underneath someone mid-transaction. `vite-plugin-pwa` is configured
 * with `registerType: 'prompt'` and `injectRegister: null` for that reason.
 */

type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;

// `registerSW` must run once per page load; keep it module-scoped so React
// StrictMode's double-invoked effects cannot register the worker twice.
let updateServiceWorker: UpdateServiceWorker | null = null;

export interface UseAppUpdateReturn {
  /** The "new version ready" prompt should be shown. */
  promptVisible: boolean;
  /** An update is being applied; disable the actions. */
  applying: boolean;
  /** Why the last update attempt failed, if it did. */
  error: string | null;
  applyUpdate: () => void;
  dismiss: () => void;
}

export function useAppUpdate(): UseAppUpdateReturn {
  const [state, dispatch] = useReducer(reduceUpdateState, initialUpdateState);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    updateServiceWorker ??= registerSW({
      immediate: true,
      onNeedRefresh: () => dispatch({ type: 'NEED_REFRESH' }),
      onRegisterError: (error: unknown) =>
        dispatch({
          type: 'ERROR',
          error: error instanceof Error ? error.message : 'Service worker registration failed',
        }),
    });
  }, []);

  const applyUpdate = useCallback(() => {
    dispatch({ type: 'APPLY' });
    // The worker posts SKIP_WAITING and workbox-window reloads on `controlling`.
    void updateServiceWorker?.(true).catch((error: unknown) => {
      if (!mounted.current) return;
      dispatch({
        type: 'ERROR',
        error: error instanceof Error ? error.message : 'Update failed',
      });
    });
  }, []);

  const dismiss = useCallback(() => dispatch({ type: 'DISMISS' }), []);

  return {
    promptVisible: shouldPromptForUpdate(state),
    applying: isApplyingUpdate(state),
    error: state.error,
    applyUpdate,
    dismiss,
  };
}
