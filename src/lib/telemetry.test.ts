import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConsent, setConsent, subscribeToConsent } from './telemetry';

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
}

describe('telemetry consent subscriptions', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMemoryStorage());
    vi.stubGlobal('window', new EventTarget());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('notifies same-tab subscribers immediately when consent changes', () => {
    let updates = 0;
    const unsubscribe = subscribeToConsent(() => {
      updates += 1;
    });

    setConsent('accepted');

    expect(getConsent()).toBe('accepted');
    expect(updates).toBe(1);

    unsubscribe();
    setConsent('declined');
    expect(updates).toBe(1);
  });

  it('notifies subscribers when another tab clears storage', () => {
    let updates = 0;
    const unsubscribe = subscribeToConsent(() => {
      updates += 1;
    });

    const event = new Event('storage') as StorageEvent;
    Object.defineProperty(event, 'key', { value: null });
    window.dispatchEvent(event);

    expect(updates).toBe(1);
    unsubscribe();
  });

  it('returns null when storage access is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });

    expect(getConsent()).toBeNull();
    expect(() => setConsent('accepted')).not.toThrow();
  });

  it('is safe when window and localStorage are unavailable', () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('localStorage', undefined);

    expect(getConsent()).toBeNull();
    expect(() => setConsent('accepted')).not.toThrow();
    expect(() => subscribeToConsent(() => undefined)()).not.toThrow();
  });
});
