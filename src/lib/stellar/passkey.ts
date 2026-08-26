/**
 * src/lib/stellar/passkey.ts
 *
 * Browser-side WebAuthn plumbing for the Passkey wallet mode. Everything
 * here is pure Web Authentication API + PRF extension handling — it never
 * talks to Horizon or Soroban. `PasskeyAdapter` uses the secret this module
 * derives to seed a classic Ed25519 Stellar signing key (see the scope note
 * at the top of PasskeyAdapter.ts for why it's classic rather than a
 * Soroban smart account).
 *
 * The PRF extension (https://w3c.github.io/webauthn/#prf-extension) lets a
 * passkey act as a deterministic key-derivation function: evaluating the same
 * salt against the same credential always returns the same 32-byte secret,
 * without ever exposing the authenticator's private key. That secret is what
 * seeds the account's signing key.
 */

const RP_SALT_LABEL = new TextEncoder().encode('wraith-protocol:stellar:passkey:v1');

export type PasskeyErrorCode =
  | 'PRF_UNSUPPORTED'
  | 'NO_CREDENTIAL'
  | 'USER_REJECTED'
  | 'CREATE_FAILED'
  | 'GET_FAILED';

export class PasskeyError extends Error {
  constructor(
    message: string,
    public readonly code: PasskeyErrorCode,
  ) {
    super(message);
    this.name = 'PasskeyError';
  }
}

// ─── base64url helpers ──────────────────────────────────────────────────────

export function bufferToBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBuffer(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padLength));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ─── Feature detection ──────────────────────────────────────────────────────

/**
 * Best-effort check for whether this browser can plausibly support the PRF
 * extension. WebAuthn's `getClientCapabilities()` (when present) reports it
 * directly; older browsers only reveal PRF support at credential-creation
 * time, so this is a necessary-but-not-sufficient gate used to decide
 * whether to attempt the first-run flow at all.
 */
export async function isPrfLikelySupported(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;

  const getClientCapabilities = (
    window.PublicKeyCredential as unknown as {
      getClientCapabilities?: () => Promise<Record<string, boolean>>;
    }
  ).getClientCapabilities;

  if (typeof getClientCapabilities === 'function') {
    try {
      const capabilities = await getClientCapabilities();
      if ('extension:prf' in capabilities) return capabilities['extension:prf'];
    } catch {
      // Fall through to the permissive default below.
    }
  }

  // No capability API available — assume support and let credential
  // creation/assertion surface a PRF_UNSUPPORTED error if it turns out wrong.
  return true;
}

// ─── PRF extension result parsing (pure — unit tested) ─────────────────────

interface PrfExtensionOutput {
  enabled?: boolean;
  results?: {
    first?: BufferSource;
    second?: BufferSource;
  };
}

// Deliberately not `extends AuthenticationExtensionsClientOutputs` — lib.dom's
// AuthenticationExtensionsPRFOutputs requires `results.first` whenever `results`
// is present, which is stricter than what we want to assert before validating it.
interface ExtensionResultsWithPrf {
  prf?: PrfExtensionOutput;
}

/**
 * Extracts the 32-byte PRF secret from a WebAuthn credential's client
 * extension results. Used for both `create()` and `get()` outputs — the
 * shape of the `prf` extension member is identical in both.
 *
 * Throws `PasskeyError('PRF_UNSUPPORTED', …)` whenever the authenticator
 * did not evaluate the PRF extension, so callers can render the no-PRF
 * next-step card instead of failing silently.
 */
export function parsePrfExtensionResult(
  extensionResults: AuthenticationExtensionsClientOutputs | null | undefined,
): Uint8Array {
  const prf = (extensionResults as ExtensionResultsWithPrf | null | undefined)?.prf;

  if (!prf) {
    throw new PasskeyError(
      'This authenticator did not return a PRF extension result.',
      'PRF_UNSUPPORTED',
    );
  }

  if (prf.enabled === false) {
    throw new PasskeyError(
      'This authenticator reported the PRF extension as unavailable.',
      'PRF_UNSUPPORTED',
    );
  }

  const first = prf.results?.first;
  if (!first) {
    throw new PasskeyError(
      'The authenticator did not evaluate the PRF salt for this credential.',
      'PRF_UNSUPPORTED',
    );
  }

  const secret = first instanceof Uint8Array ? first : new Uint8Array(first as ArrayBuffer);
  if (secret.length === 0) {
    throw new PasskeyError('The PRF extension returned an empty secret.', 'PRF_UNSUPPORTED');
  }

  return secret;
}

// ─── Credential creation / assertion ────────────────────────────────────────

export interface CreatePasskeyResult {
  credentialId: Uint8Array;
  prfSecret: Uint8Array;
}

/**
 * Registers a new platform passkey with the PRF extension requested, and
 * returns both the credential id (to persist for future sign-in) and the
 * derived secret (to seed the smart-account signing key).
 */
export async function createPasskeyCredential(opts: {
  rpId: string;
  rpName: string;
  userName: string;
}): Promise<CreatePasskeyResult> {
  if (typeof navigator === 'undefined' || !navigator.credentials) {
    throw new PasskeyError('WebAuthn is not available in this browser.', 'PRF_UNSUPPORTED');
  }

  const userId = crypto.getRandomValues(new Uint8Array(16));
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  let credential: Credential | null;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        rp: { id: opts.rpId, name: opts.rpName },
        user: { id: userId, name: opts.userName, displayName: opts.userName },
        challenge,
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256 fallback
        ],
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
        },
        extensions: {
          prf: { eval: { first: RP_SALT_LABEL } },
        } as AuthenticationExtensionsClientInputs,
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      throw new PasskeyError('Passkey creation was cancelled.', 'USER_REJECTED');
    }
    throw new PasskeyError(`Passkey creation failed: ${String(err)}`, 'CREATE_FAILED');
  }

  if (!credential) {
    throw new PasskeyError('Passkey creation returned no credential.', 'CREATE_FAILED');
  }

  const publicKeyCredential = credential as PublicKeyCredential;
  const prfSecret = parsePrfExtensionResult(publicKeyCredential.getClientExtensionResults());

  return {
    credentialId: new Uint8Array(publicKeyCredential.rawId),
    prfSecret,
  };
}

/**
 * Re-authenticates against a previously registered credential and
 * re-derives the same PRF secret (deterministic for a given credential +
 * salt), so the account's signing key never needs to be persisted.
 */
export async function getPasskeyAssertion(credentialId: Uint8Array): Promise<Uint8Array> {
  if (typeof navigator === 'undefined' || !navigator.credentials) {
    throw new PasskeyError('WebAuthn is not available in this browser.', 'PRF_UNSUPPORTED');
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));

  let assertion: Credential | null;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ id: credentialId as BufferSource, type: 'public-key' }],
        userVerification: 'required',
        extensions: {
          prf: { eval: { first: RP_SALT_LABEL } },
        } as AuthenticationExtensionsClientInputs,
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      throw new PasskeyError('Passkey sign-in was cancelled.', 'USER_REJECTED');
    }
    throw new PasskeyError(`Passkey sign-in failed: ${String(err)}`, 'GET_FAILED');
  }

  if (!assertion) {
    throw new PasskeyError('No matching passkey was found.', 'NO_CREDENTIAL');
  }

  const publicKeyCredential = assertion as PublicKeyCredential;
  return parsePrfExtensionResult(publicKeyCredential.getClientExtensionResults());
}

// ─── Session-key ceiling ─────────────────────────────────────────────────────

/**
 * The signing key derived from one PRF ceremony is kept resident in memory
 * and reused for repeated signs within a browser session, instead of
 * re-running the PRF ceremony (and its biometric prompt) on every send.
 * Both ceilings are enforced together — whichever is hit first ends the
 * session and the next sign re-derives the key from a fresh PRF assertion.
 */
export const SESSION_KEY_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const SESSION_KEY_MAX_SIGNATURES = 20;

export interface PasskeySession {
  createdAt: number;
  signatureCount: number;
}

export function isSessionValid(session: PasskeySession | null): session is PasskeySession {
  if (!session) return false;
  const age = Date.now() - session.createdAt;
  return age < SESSION_KEY_TTL_MS && session.signatureCount < SESSION_KEY_MAX_SIGNATURES;
}
