import { APP_VERSION, compatibleVersion, COMPATIBILITY_MESSAGE } from './appCompatibility';
import {
  cancelPreparedUpdate,
  prepareForUpdate,
  setCompatibilityError,
} from './transactionActivity';

export function workerRequest(worker: ServiceWorker, type: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error('The update did not respond. Keep this tab open and try again.'));
    }, 5000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data);
    };
    worker.postMessage({ type, version: APP_VERSION }, [channel.port2]);
  });
}

export async function checkControllerVersion() {
  const controller = navigator.serviceWorker.controller;
  if (!controller) return;
  setCompatibilityError('Checking the application version before allowing transactions.');
  try {
    const version = await workerRequest(controller, 'GET_APP_VERSION');
    setCompatibilityError(compatibleVersion(version) ? null : COMPATIBILITY_MESSAGE);
  } catch {
    setCompatibilityError(COMPATIBILITY_MESSAGE);
  }
}

/** Older or unresponsive clients cannot silently approve an update. */
export function listenForUpdatePreparation() {
  const listener = (event: MessageEvent) => {
    if (event.data?.type === 'CANCEL_APP_UPDATE') {
      cancelPreparedUpdate();
    }
    if (event.data?.type !== 'PREPARE_APP_UPDATE' || !event.ports[0]) return;
    const saved = window.dispatchEvent(new Event('wraith:save-drafts', { cancelable: true }));
    const ready = saved && prepareForUpdate();
    event.ports[0].postMessage({ ready });
  };
  navigator.serviceWorker.addEventListener('message', listener);
  return () => {
    navigator.serviceWorker.removeEventListener('message', listener);
  };
}
