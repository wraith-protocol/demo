import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import {
  initialUpdateState,
  isApplyingUpdate,
  reduceUpdateState,
  shouldPromptForUpdate,
} from '@/lib/swUpdate';
import {
  activeTransactionReason,
  cancelPreparedUpdate,
  prepareForUpdate,
  subscribeTransactionActivity,
  transactionBlockReason,
} from '@/lib/transactionActivity';
import {
  checkControllerVersion,
  listenForUpdatePreparation,
  workerRequest,
} from '@/lib/swUpdateClient';

let registrationPromise: Promise<ServiceWorkerRegistration> | undefined;

export function useAppUpdate() {
  const [state, dispatch] = useReducer(reduceUpdateState, initialUpdateState);
  const [online, setOnline] = useState(navigator.onLine);
  const reloadAccepted = useRef(false);
  const busy = useRef(false);
  const transactionReason = useSyncExternalStore(
    subscribeTransactionActivity,
    activeTransactionReason,
  );
  const compatibilityError = useSyncExternalStore(
    subscribeTransactionActivity,
    transactionBlockReason,
  );
  const blockedReason =
    transactionReason ??
    (!online ? 'Reconnect before applying the update. Your draft is saved.' : null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const stopListening = listenForUpdatePreparation();
    const onControllerChange = () => {
      if (reloadAccepted.current) window.location.reload();
      else {
        cancelPreparedUpdate();
        void checkControllerVersion();
      }
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    void checkControllerVersion();
    let registration: ServiceWorkerRegistration | undefined;
    const onWaiting = () => {
      if (registration?.waiting) dispatch({ type: 'NEED_REFRESH' });
      const installing = registration?.installing;
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          dispatch({ type: 'NEED_REFRESH' });
        }
      });
    };
    if (import.meta.env.PROD) {
      registrationPromise ??= navigator.serviceWorker.register(
        `${import.meta.env.BASE_URL}app-sw.js`,
        { updateViaCache: 'none' },
      );
      void registrationPromise
        .then((value) => {
          registration = value;
          registration.addEventListener('updatefound', onWaiting);
          onWaiting();
        })
        .catch((error: unknown) => dispatch({ type: 'ERROR', error: String(error) }));
    }
    const onStorage = () => {
      void checkControllerVersion();
    };
    const onOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOnline);
    window.addEventListener('storage', onStorage);
    return () => {
      stopListening();
      registration?.removeEventListener('updatefound', onWaiting);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOnline);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const applyUpdate = useCallback(async () => {
    if (busy.current || activeTransactionReason() || !navigator.onLine) return;
    busy.current = true;
    dispatch({ type: 'APPLY' });
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration?.waiting) {
        if (
          window.dispatchEvent(new Event('wraith:save-drafts', { cancelable: true })) &&
          prepareForUpdate()
        ) {
          window.location.reload();
          return;
        }
        throw new Error(
          'Keep this tab open until its transaction is finished and its draft can be saved.',
        );
      }
      reloadAccepted.current = true;
      const result = (await workerRequest(registration.waiting, 'SKIP_WAITING')) as {
        ready?: boolean;
      };
      if (!result?.ready)
        throw new Error(
          'An open tab is busy or could not save its draft. Finish its transaction or close that tab, then try Reload again.',
        );
    } catch (error) {
      reloadAccepted.current = false;
      cancelPreparedUpdate();
      dispatch({ type: 'ERROR', error: error instanceof Error ? error.message : 'Update failed' });
    } finally {
      busy.current = false;
    }
  }, []);

  return {
    promptVisible: shouldPromptForUpdate(state),
    applying: isApplyingUpdate(state),
    blockedReason,
    compatibilityError,
    error: state.error,
    applyUpdate,
    dismiss: () => dispatch({ type: 'DISMISS' }),
  };
}
