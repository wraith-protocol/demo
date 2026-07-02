const STORAGE_KEY = 'wraith-telemetry-consent';

export type ConsentState = 'accepted' | 'declined' | null;

export function getConsent(): ConsentState {
  const val = localStorage.getItem(STORAGE_KEY);
  if (val === 'accepted' || val === 'declined') return val;
  return null;
}

export function setConsent(state: 'accepted' | 'declined'): void {
  localStorage.setItem(STORAGE_KEY, state);
}

function isEnabled(): boolean {
  return getConsent() === 'accepted';
}

export function trackPageView(path: string): void {
  if (!isEnabled()) return;
  if (typeof window.plausible === 'undefined') return;
  window.plausible('pageview', { u: window.location.origin + path });
}

export function trackEvent(name: string): void {
  if (!isEnabled()) return;
  if (typeof window.plausible === 'undefined') return;
  window.plausible(name);
}

declare global {
  interface Window {
    plausible?: (event: string, options?: { u?: string }) => void;
  }
}