const STORAGE_KEY = 'wraith-telemetry-consent';
const CONSENT_CHANGE_EVENT = 'wraith-telemetry-consent-change';

export type ConsentState = 'accepted' | 'declined' | null;

export function getConsent(): ConsentState {
  if (typeof localStorage === 'undefined') return null;

  try {
    const val = localStorage.getItem(STORAGE_KEY);
    if (val === 'accepted' || val === 'declined') return val;
  } catch {
    return null;
  }

  return null;
}

export function setConsent(state: 'accepted' | 'declined'): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(STORAGE_KEY, state);
  } catch {
    return;
  }

  window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT));
}

export function subscribeToConsent(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  function handleStorage(event: StorageEvent) {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  }

  window.addEventListener(CONSENT_CHANGE_EVENT, onChange);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(CONSENT_CHANGE_EVENT, onChange);
    window.removeEventListener('storage', handleStorage);
  };
}

export function isTelemetryEnabled(): boolean {
  return getConsent() === 'accepted';
}

export function trackPageView(path: string): void {
  if (!isTelemetryEnabled()) return;
  if (typeof window === 'undefined' || typeof window.plausible === 'undefined') return;
  window.plausible('pageview', { u: window.location.origin + path });
}

export function trackEvent(name: string): void {
  if (!isTelemetryEnabled()) return;
  if (typeof window === 'undefined' || typeof window.plausible === 'undefined') return;
  window.plausible(name);
}

declare global {
  interface Window {
    plausible?: (event: string, options?: { u?: string }) => void;
  }
}
