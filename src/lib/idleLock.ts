export const APP_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  'pointerdown',
  'keydown',
  'touchstart',
  'scroll',
];

export interface IdleLockOptions {
  timeoutMs: number;
  onIdle: () => void;
  lockOnBlur?: boolean;
  lockOnVisibilityChange?: boolean;
}

/**
 * Shared inactivity timer used by both the encrypted vault and the app session.
 * It checks elapsed wall-clock time when a mobile tab becomes visible again so
 * background timer throttling cannot leave a stale session unlocked.
 */
export class IdleLock {
  private timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private lastActivityAt = 0;
  private started = false;

  private readonly handleActivity = () => this.touch();
  private readonly handleBlur = () => {
    if (this.options.lockOnBlur) this.fire();
  };
  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden' && this.options.lockOnVisibilityChange) {
      this.fire();
      return;
    }

    if (document.visibilityState === 'visible') this.checkElapsedTime();
  };

  constructor(private readonly options: IdleLockOptions) {}

  start() {
    if (typeof window === 'undefined' || this.options.timeoutMs <= 0) return;

    this.stop();
    this.started = true;
    this.lastActivityAt = Date.now();
    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, this.handleActivity, { passive: true });
    }
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.schedule();
  }

  stop() {
    this.clearTimer();
    if (!this.started || typeof window === 'undefined') return;

    for (const eventName of ACTIVITY_EVENTS) {
      window.removeEventListener(eventName, this.handleActivity);
    }
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.started = false;
  }

  touch() {
    if (!this.started) return;
    this.lastActivityAt = Date.now();
    this.schedule();
  }

  private checkElapsedTime() {
    if (!this.started) return;
    if (Date.now() - this.lastActivityAt >= this.options.timeoutMs) {
      this.fire();
    } else {
      this.schedule();
    }
  }

  private schedule() {
    this.clearTimer();
    if (!this.started) return;

    const remaining = Math.max(0, this.options.timeoutMs - (Date.now() - this.lastActivityAt));
    this.timer = globalThis.setTimeout(() => this.checkElapsedTime(), remaining);
  }

  private fire() {
    if (!this.started) return;
    this.stop();
    this.options.onIdle();
  }

  private clearTimer() {
    if (this.timer === null) return;
    globalThis.clearTimeout(this.timer);
    this.timer = null;
  }
}

export function isPasskeySupported() {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window;
}

export async function authenticateWithPasskey(): Promise<void> {
  if (!isPasskeySupported()) throw new Error('Passkeys are not supported on this device.');

  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: globalThis.crypto.getRandomValues(new Uint8Array(32)),
      timeout: 60_000,
      userVerification: 'required',
    },
  });

  if (!credential) throw new Error('No passkey is available for Wraith.');
}
