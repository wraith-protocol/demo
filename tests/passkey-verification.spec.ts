import { test, expect } from '@playwright/test';

test.describe('WebAuthn assertion verification', () => {
  test('accepts a correctly bound assertion', async ({ page }) => {
    await page.goto('/', { waitUntil: 'commit' });
    const result = await page.evaluate(async () => {
      const { verifyPasskeyAssertion } = await import('/src/lib/stellar/passkey.ts');
      const credentialId = new Uint8Array([1, 2, 3, 4]);
      const challenge = new Uint8Array(32).fill(7);
      const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      );
      const publicKeySpki = new Uint8Array(
        await crypto.subtle.exportKey('spki', keyPair.publicKey),
      );
      const clientDataJSON = new TextEncoder().encode(
        JSON.stringify({
          type: 'webauthn.get',
          challenge: btoa(String.fromCharCode(...challenge))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, ''),
          origin: window.location.origin,
        }),
      );
      const rpHash = new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(window.location.hostname)),
      );
      const authenticatorData = new Uint8Array(37);
      authenticatorData.set(rpHash);
      authenticatorData[32] = 0x05; // user present + user verified
      new DataView(authenticatorData.buffer).setUint32(33, 1);
      const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON));
      const signedData = new Uint8Array(authenticatorData.length + clientDataHash.length);
      signedData.set(authenticatorData);
      signedData.set(clientDataHash, authenticatorData.length);
      const signature = new Uint8Array(
        await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          keyPair.privateKey,
          signedData,
        ),
      );
      const signCount = await verifyPasskeyAssertion({
        assertion: {
          rawId: credentialId.buffer,
          response: { clientDataJSON, authenticatorData, signature },
        } as unknown as PublicKeyCredential,
        expectedCredentialId: credentialId,
        expectedChallenge: challenge,
        expectedRpId: window.location.hostname,
        expectedOrigin: window.location.origin,
        publicKeySpki,
        publicKeyAlgorithm: -7,
        previousSignCount: 0,
      });
      return signCount;
    });

    expect(result).toBe(1);
  });

  test('rejects an assertion bound to a different challenge', async ({ page }) => {
    await page.goto('/', { waitUntil: 'commit' });
    const code = await page.evaluate(async () => {
      const { PasskeyError, verifyPasskeyAssertion } = await import('/src/lib/stellar/passkey.ts');
      const challenge = new Uint8Array(32).fill(1);
      const expectedChallenge = new Uint8Array(32).fill(2);
      const clientDataJSON = new TextEncoder().encode(
        JSON.stringify({
          type: 'webauthn.get',
          challenge: btoa(String.fromCharCode(...challenge))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, ''),
          origin: window.location.origin,
        }),
      );
      try {
        await verifyPasskeyAssertion({
          assertion: {
            rawId: new Uint8Array([1]).buffer,
            response: {
              clientDataJSON,
              authenticatorData: new Uint8Array(37),
              signature: new Uint8Array(64),
            },
          } as unknown as PublicKeyCredential,
          expectedCredentialId: new Uint8Array([1]),
          expectedChallenge,
          expectedRpId: window.location.hostname,
          expectedOrigin: window.location.origin,
          publicKeySpki: new Uint8Array(),
          publicKeyAlgorithm: -7,
          previousSignCount: 0,
        });
        return 'accepted';
      } catch (error) {
        return error instanceof PasskeyError ? error.code : 'unknown';
      }
    });

    expect(code).toBe('GET_FAILED');
  });
});
