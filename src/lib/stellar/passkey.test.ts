import { describe, it, expect } from 'vitest';
import {
  parsePrfExtensionResult,
  bufferToBase64Url,
  base64UrlToBuffer,
  isSessionValid,
  SESSION_KEY_TTL_MS,
  SESSION_KEY_MAX_SIGNATURES,
  PasskeyError,
  type PasskeySession,
} from './passkey';

// ── parsePrfExtensionResult ─────────────────────────────────────────────────

describe('parsePrfExtensionResult', () => {
  it('extracts the PRF secret when present', () => {
    const secretBytes = new Uint8Array(32).fill(7);
    const result = parsePrfExtensionResult({
      prf: { enabled: true, results: { first: secretBytes } },
    } as AuthenticationExtensionsClientOutputs);

    expect(result).toEqual(secretBytes);
  });

  it('accepts an ArrayBuffer for the first result', () => {
    const secretBytes = new Uint8Array(32).fill(3);
    const result = parsePrfExtensionResult({
      prf: { enabled: true, results: { first: secretBytes.buffer } },
    } as AuthenticationExtensionsClientOutputs);

    expect(result).toEqual(secretBytes);
  });

  it('throws PRF_UNSUPPORTED when the prf member is absent', () => {
    expect(() => parsePrfExtensionResult({} as AuthenticationExtensionsClientOutputs)).toThrow(
      PasskeyError,
    );
    try {
      parsePrfExtensionResult({} as AuthenticationExtensionsClientOutputs);
    } catch (err) {
      expect((err as PasskeyError).code).toBe('PRF_UNSUPPORTED');
    }
  });

  it('throws PRF_UNSUPPORTED when the extension results are null', () => {
    expect(() => parsePrfExtensionResult(null)).toThrow(PasskeyError);
  });

  it('throws PRF_UNSUPPORTED when enabled is explicitly false', () => {
    expect(() =>
      parsePrfExtensionResult({
        prf: { enabled: false },
      } as AuthenticationExtensionsClientOutputs),
    ).toThrow(/unavailable/);
  });

  it('throws PRF_UNSUPPORTED when results.first is missing', () => {
    expect(() =>
      parsePrfExtensionResult({
        prf: { enabled: true, results: {} },
      } as AuthenticationExtensionsClientOutputs),
    ).toThrow(/did not evaluate/);
  });

  it('throws PRF_UNSUPPORTED when the secret is empty', () => {
    expect(() =>
      parsePrfExtensionResult({
        prf: { enabled: true, results: { first: new Uint8Array(0) } },
      } as AuthenticationExtensionsClientOutputs),
    ).toThrow(/empty secret/);
  });
});

// ── base64url helpers ───────────────────────────────────────────────────────

describe('base64url helpers', () => {
  it('round-trips arbitrary byte sequences', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255, 16, 32, 64, 128]);
    expect(base64UrlToBuffer(bufferToBase64Url(bytes))).toEqual(bytes);
  });

  it('produces URL-safe output with no padding', () => {
    const bytes = new Uint8Array(33).fill(255);
    const encoded = bufferToBase64Url(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

// ── session ceiling ─────────────────────────────────────────────────────────

describe('isSessionValid', () => {
  function makeSession(overrides: Partial<PasskeySession> = {}): PasskeySession {
    return {
      createdAt: Date.now(),
      signatureCount: 0,
      ...overrides,
    };
  }

  it('returns false for null', () => {
    expect(isSessionValid(null)).toBe(false);
  });

  it('returns true for a fresh session under both ceilings', () => {
    expect(isSessionValid(makeSession())).toBe(true);
  });

  it('returns false once the TTL has elapsed', () => {
    const session = makeSession({ createdAt: Date.now() - SESSION_KEY_TTL_MS - 1 });
    expect(isSessionValid(session)).toBe(false);
  });

  it('returns false once the signature ceiling is reached', () => {
    const session = makeSession({ signatureCount: SESSION_KEY_MAX_SIGNATURES });
    expect(isSessionValid(session)).toBe(false);
  });
});
