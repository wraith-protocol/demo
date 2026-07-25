const PASSKEY_STORAGE_KEY = 'wraith:stellar:passkey-state';
let memoryStorage: Record<string, string> = {};

export interface PasskeyPreferenceState {
  enabled: boolean;
  registered: boolean;
  supported: boolean;
  credentialId: string | null;
}

export type PasskeyPreferenceStateInput = Partial<PasskeyPreferenceState>;

interface RegisterPasskeyOptions {
  userName?: string;
}

interface AuthenticatePasskeyOptions {
  message?: string;
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

function readMemoryStorage() {
  return memoryStorage;
}

function readPersistedState(): PasskeyPreferenceState | null {
  const storage = getStorage();
  if (storage) {
    const raw = storage.getItem(PASSKEY_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<PasskeyPreferenceState>;
        return {
          enabled: Boolean(parsed.enabled),
          registered: Boolean(parsed.registered),
          supported: Boolean(parsed.supported),
          credentialId: typeof parsed.credentialId === 'string' ? parsed.credentialId : null,
        };
      } catch {
        return null;
      }
    }
  }

  const mem = readMemoryStorage();
  const raw = mem[PASSKEY_STORAGE_KEY];
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<PasskeyPreferenceState>;
    return {
      enabled: Boolean(parsed.enabled),
      registered: Boolean(parsed.registered),
      supported: Boolean(parsed.supported),
      credentialId: typeof parsed.credentialId === 'string' ? parsed.credentialId : null,
    };
  } catch {
    return null;
  }
}

function persistState(state: PasskeyPreferenceState) {
  const storage = getStorage();
  if (storage) {
    storage.setItem(PASSKEY_STORAGE_KEY, JSON.stringify(state));
    return;
  }
  memoryStorage[PASSKEY_STORAGE_KEY] = JSON.stringify(state);
}

function normalizeState(state?: Partial<PasskeyPreferenceState>): PasskeyPreferenceState {
  const supported = isPasskeySupported();
  const fallback = {
    enabled: false,
    registered: false,
    supported,
    credentialId: null,
  };

  if (!state) {
    const stored = readPersistedState();
    return stored ? { ...fallback, ...stored, supported } : fallback;
  }

  return {
    ...fallback,
    ...state,
    supported,
  };
}

export function isPasskeySupported() {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.credentials
  );
}

export function getPasskeyState(): PasskeyPreferenceState {
  return normalizeState(readPersistedState() ?? undefined);
}

export function setPasskeyEnabled(enabled: boolean): PasskeyPreferenceState {
  const current = getPasskeyState();
  const next = normalizeState({
    enabled,
    registered: current.registered,
    credentialId: current.credentialId,
  });
  persistState(next);
  return next;
}

export function shouldUsePasskey(state: PasskeyPreferenceStateInput): boolean {
  const supported = state.supported ?? isPasskeySupported();
  return supported && Boolean(state.enabled) && Boolean(state.registered);
}

export async function registerPasskey({ userName = 'wraith-demo' }: RegisterPasskeyOptions = {}) {
  if (!isPasskeySupported()) {
    throw new Error('This browser does not support WebAuthn passkeys.');
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const rpId = getRpId();

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'Wraith Demo', id: rpId },
      user: {
        id: userId,
        name: userName,
        displayName: userName,
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
      timeout: 60000,
    },
  })) as {
    rawId?: ArrayBuffer | Uint8Array | null;
    response?: { attestationObject?: unknown; clientDataJSON?: unknown };
  } | null;

  const credentialId = credential?.rawId ? bufferToBase64Url(credential.rawId) : null;
  if (!credentialId) {
    throw new Error('The authenticator did not return a credential id.');
  }

  const next = normalizeState({
    enabled: true,
    registered: true,
    credentialId,
  });
  persistState(next);
  return next;
}

export async function authenticateWithPasskey({
  message = 'Wraith stealth signing',
}: AuthenticatePasskeyOptions = {}) {
  const state = getPasskeyState();
  if (!shouldUsePasskey(state) || !state.credentialId) {
    throw new Error('Passkey signing is disabled or not registered.');
  }

  const challenge = await createChallenge(message);
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge,
      timeout: 60000,
      userVerification: 'required',
      allowCredentials: [
        {
          id: base64UrlToBuffer(state.credentialId),
          type: 'public-key',
          transports: ['internal', 'hybrid'],
        },
      ],
    },
  })) as { response?: { signature?: ArrayBuffer | Uint8Array | null } } | null;

  const signature = credential?.response?.signature;
  if (!signature) {
    throw new Error('The authenticator did not return a signature.');
  }

  return toUint8Array(signature);
}

function getRpId() {
  if (typeof window === 'undefined') return 'localhost';
  const hostname = window.location.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' ? 'localhost' : hostname;
}

async function createChallenge(message: string) {
  if (typeof crypto !== 'undefined' && 'subtle' in crypto) {
    const encoded = new TextEncoder().encode(message);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return digest;
  }
  return new TextEncoder().encode(message);
}

function bufferToBase64Url(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBuffer(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = pad === 0 ? normalized : normalized + '='.repeat(4 - pad);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toUint8Array(value: ArrayBuffer | Uint8Array | number[]) {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  return new Uint8Array(value);
}
