import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateWithPasskey, registerPasskey, shouldUsePasskey } from './passkey';

describe('shouldUsePasskey', () => {
  it('falls back to Freighter when passkey is disabled or not registered', () => {
    expect(shouldUsePasskey({ enabled: false, registered: true, supported: true })).toBe(false);
    expect(shouldUsePasskey({ enabled: true, registered: false, supported: true })).toBe(false);
    expect(shouldUsePasskey({ enabled: true, registered: true, supported: false })).toBe(false);
  });

  it('uses passkey signing when the browser supports it and registration exists', () => {
    expect(shouldUsePasskey({ enabled: true, registered: true, supported: true })).toBe(true);
  });
});

describe('registerPasskey', () => {
  const createSpy = vi.fn();
  const getSpy = vi.fn();

  beforeEach(() => {
    createSpy.mockReset();
    getSpy.mockReset();

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        credentials: {
          create: createSpy,
          get: getSpy,
        },
      },
    });

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        PublicKeyCredential: class {},
        location: { hostname: 'localhost' },
      },
    });
  });

  it('stores the credential id returned by the browser authenticator', async () => {
    createSpy.mockResolvedValue({
      response: {
        attestationObject: new Uint8Array([1, 2, 3]),
        clientDataJSON: new Uint8Array([4, 5, 6]),
      },
      rawId: new Uint8Array([7, 8, 9]),
    });

    const result = await registerPasskey({ userName: 'demo-user' });

    expect(result.credentialId).toBeTruthy();
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('returns a signature from the authenticator when unlocking', async () => {
    getSpy.mockResolvedValue({
      response: { signature: new Uint8Array([11, 22, 33]) },
    });

    const signature = await authenticateWithPasskey({ message: 'hello' });

    expect(signature).toEqual(new Uint8Array([11, 22, 33]));
    expect(getSpy).toHaveBeenCalledTimes(1);
  });
});
