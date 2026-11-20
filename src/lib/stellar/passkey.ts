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

export const PASSKEY_CREDENTIAL_ID_STORAGE_KEY = 'wraith:passkey:credentialId';
export const PASSKEY_ADDRESS_STORAGE_KEY = 'wraith:passkey:address';
export const PASSKEY_PUBLIC_KEY_STORAGE_KEY = 'wraith:passkey:publicKey';
export const PASSKEY_PUBLIC_KEY_ALGORITHM_STORAGE_KEY = 'wraith:passkey:publicKeyAlgorithm';
export const PASSKEY_SIGN_COUNT_STORAGE_KEY = 'wraith:passkey:signCount';

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
  publicKeySpki: Uint8Array;
  publicKeyAlgorithm: number;
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
  const attestation = publicKeyCredential.response as AuthenticatorAttestationResponse;
  const publicKey = attestation.getPublicKey?.();
  const publicKeyAlgorithm = attestation.getPublicKeyAlgorithm?.();
  if (!publicKey || typeof publicKeyAlgorithm !== 'number') {
    throw new PasskeyError(
      'The authenticator did not return a verifiable public key.',
      'CREATE_FAILED',
    );
  }
  const prfSecret = parsePrfExtensionResult(publicKeyCredential.getClientExtensionResults());

  return {
    credentialId: new Uint8Array(publicKeyCredential.rawId),
    prfSecret,
    publicKeySpki: new Uint8Array(publicKey),
    publicKeyAlgorithm,
  };
}

function derSignatureToP1363(signature: Uint8Array): Uint8Array {
  if (signature.length === 64) return signature;
  if (signature[0] !== 0x30) throw new Error('Invalid ECDSA signature encoding.');
  let offset = 2;
  if (signature[1] & 0x80) offset += signature[1] & 0x7f;
  if (signature[offset++] !== 0x02) throw new Error('Invalid ECDSA signature r value.');
  const rLength = signature[offset++];
  const r = signature.slice(offset, offset + rLength);
  offset += rLength;
  if (signature[offset++] !== 0x02) throw new Error('Invalid ECDSA signature s value.');
  const sLength = signature[offset++];
  const s = signature.slice(offset, offset + sLength);
  if (r.length > 33 || s.length > 33) throw new Error('Invalid ECDSA signature length.');
  const result = new Uint8Array(64);
  result.set(r.slice(r.length > 32 ? 1 : 0), 32 - Math.min(32, r.length));
  result.set(s.slice(s.length > 32 ? 1 : 0), 64 - Math.min(32, s.length));
  return result;
}

export interface PasskeyAssertionVerificationOptions {
  assertion: PublicKeyCredential;
  expectedCredentialId: Uint8Array;
  expectedChallenge: Uint8Array;
  expectedRpId: string;
  expectedOrigin: string;
  publicKeySpki: Uint8Array;
  publicKeyAlgorithm: number;
  previousSignCount: number;
}

/** Verify the complete WebAuthn assertion envelope before using its PRF output. */
export async function verifyPasskeyAssertion(
  options: PasskeyAssertionVerificationOptions,
): Promise<number> {
  const { assertion } = options;
  const response = assertion.response as AuthenticatorAssertionResponse;
  if (
    !response ||
    bufferToBase64Url(assertion.rawId) !== bufferToBase64Url(options.expectedCredentialId)
  ) {
    throw new PasskeyError('The returned passkey does not match this account.', 'GET_FAILED');
  }

  let clientData: { type?: unknown; challenge?: unknown; origin?: unknown };
  try {
    clientData = JSON.parse(new TextDecoder().decode(response.clientDataJSON)) as typeof clientData;
  } catch {
    throw new PasskeyError('The passkey returned malformed client data.', 'GET_FAILED');
  }

  if (
    clientData.type !== 'webauthn.get' ||
    clientData.origin !== options.expectedOrigin ||
    clientData.challenge !== bufferToBase64Url(options.expectedChallenge)
  ) {
    throw new PasskeyError('The passkey assertion was not issued for this request.', 'GET_FAILED');
  }

  const authenticatorData = new Uint8Array(response.authenticatorData);
  if (authenticatorData.length < 37) {
    throw new PasskeyError('The passkey returned incomplete authenticator data.', 'GET_FAILED');
  }
  const expectedRpHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(options.expectedRpId)),
  );
  if (!expectedRpHash.every((byte, index) => byte === authenticatorData[index])) {
    throw new PasskeyError(
      'The passkey assertion belongs to a different relying party.',
      'GET_FAILED',
    );
  }

  const flags = authenticatorData[32];
  if ((flags & 0x01) === 0 || (flags & 0x04) === 0) {
    throw new PasskeyError(
      'The passkey did not perform the required user verification.',
      'GET_FAILED',
    );
  }
  const signCount = new DataView(
    authenticatorData.buffer,
    authenticatorData.byteOffset + 33,
    4,
  ).getUint32(0);
  if (options.previousSignCount > 0 && signCount > 0 && signCount <= options.previousSignCount) {
    throw new PasskeyError('This passkey assertion has already been used.', 'GET_FAILED');
  }

  const clientDataHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', response.clientDataJSON),
  );
  const signedData = new Uint8Array(authenticatorData.length + clientDataHash.length);
  signedData.set(authenticatorData);
  signedData.set(clientDataHash, authenticatorData.length);
  const keyAlgorithm =
    options.publicKeyAlgorithm === -7
      ? { name: 'ECDSA', namedCurve: 'P-256' }
      : options.publicKeyAlgorithm === -257
        ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
        : null;
  if (!keyAlgorithm)
    throw new PasskeyError('The passkey uses an unsupported key algorithm.', 'GET_FAILED');

  const publicKey = await crypto.subtle.importKey(
    'spki',
    options.publicKeySpki as unknown as BufferSource,
    keyAlgorithm,
    false,
    ['verify'],
  );
  const signature = (options.publicKeyAlgorithm === -7
    ? derSignatureToP1363(new Uint8Array(response.signature))
    : response.signature) as unknown as BufferSource;
  const valid = await crypto.subtle.verify(
    options.publicKeyAlgorithm === -7
      ? { name: 'ECDSA', hash: 'SHA-256' }
      : { name: 'RSASSA-PKCS1-v1_5' },
    publicKey,
    signature,
    signedData as unknown as BufferSource,
  );
  if (!valid) throw new PasskeyError('The passkey assertion signature is invalid.', 'GET_FAILED');
  return signCount;
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
        rpId: window.location.hostname,
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
  const publicKeySpki = localStorage.getItem(PASSKEY_PUBLIC_KEY_STORAGE_KEY);
  const publicKeyAlgorithm = Number(localStorage.getItem(PASSKEY_PUBLIC_KEY_ALGORITHM_STORAGE_KEY));
  if (!publicKeySpki || !Number.isInteger(publicKeyAlgorithm)) {
    throw new PasskeyError(
      'This passkey was registered without verification metadata.',
      'GET_FAILED',
    );
  }
  const signCount = await verifyPasskeyAssertion({
    assertion: publicKeyCredential,
    expectedCredentialId: credentialId,
    expectedChallenge: challenge,
    expectedRpId: window.location.hostname,
    expectedOrigin: window.location.origin,
    publicKeySpki: base64UrlToBuffer(publicKeySpki),
    publicKeyAlgorithm,
    previousSignCount: Number(localStorage.getItem(PASSKEY_SIGN_COUNT_STORAGE_KEY) ?? '0'),
  });
  localStorage.setItem(PASSKEY_SIGN_COUNT_STORAGE_KEY, String(signCount));
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
