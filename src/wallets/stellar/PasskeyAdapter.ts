/**
 * src/wallets/stellar/PasskeyAdapter.ts
 *
 * Passkey smart-account wallet mode. Unlike the other adapters, this one
 * never talks to a browser extension: it drives the WebAuthn PRF ceremony
 * directly (see src/lib/stellar/passkey.ts) and hands the derived secret to
 * the SDK's `WebAuthnPasskeyStealthSigner`, which owns the Soroban smart
 * account (deployment, session-key delegation, and transaction signing).
 *
 * ASSUMPTION (flag during review): the exact constructor/method shape of
 * `WebAuthnPasskeyStealthSigner` below is inferred from the issue's
 * description of `sdk/src/chains/stellar/signer.ts` — it was not possible to
 * inspect the installed package from this environment. `tsc` will catch a
 * mismatch; adjust the call sites to match the real export if it differs.
 */

import {
  createPasskeyCredential,
  getPasskeyAssertion,
  isPrfLikelySupported,
  isSessionValid,
  type PasskeySession,
  PasskeyError,
  bufferToBase64Url,
  base64UrlToBuffer,
} from '@/lib/stellar/passkey';
import { STELLAR_NETWORK } from '@/config';
import type { StellarWallet, ConnectResult, SignResult, SignOpts } from './types';
import { WalletError } from './types';

const STORAGE_KEY_CREDENTIAL_ID = 'wraith:passkey:credentialId';
const STORAGE_KEY_ADDRESS = 'wraith:passkey:address';
const RP_NAME = 'Wraith Demo';
const FRIENDBOT_URL = 'https://friendbot.stellar.org';

// Self-contained key glyph — avoids depending on an external icon host.
export const PASSKEY_ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23e6e1e5" stroke-width="1.5"><circle cx="8" cy="8" r="4"/><path d="M11 11l9 9M17 14l3-3M14 17l2-2"/></svg>',
  );

interface PasskeySigner {
  getAddress(): string;
  signTransaction(xdr: string): Promise<{ signedXdr: string }>;
  deploySmartAccount?(): Promise<void>;
}

export class PasskeyAdapter implements StellarWallet {
  readonly id = 'passkey' as const;
  readonly name = 'Passkey';
  readonly icon = PASSKEY_ICON;
  readonly installUrl = 'https://passkeys.dev/device-support/';

  private session: PasskeySession | null = null;
  private signer: PasskeySigner | null = null;

  async isAvailable(): Promise<boolean> {
    try {
      return await isPrfLikelySupported();
    } catch {
      return false;
    }
  }

  async connect(): Promise<ConnectResult> {
    const supported = await this.isAvailable();
    if (!supported) {
      throw new WalletError(
        'This browser or device does not support passkeys with the PRF extension.',
        'NOT_AVAILABLE',
        'passkey',
      );
    }

    const storedCredentialId = localStorage.getItem(STORAGE_KEY_CREDENTIAL_ID);
    const storedAddress = localStorage.getItem(STORAGE_KEY_ADDRESS);

    try {
      if (storedCredentialId && storedAddress) {
        const credentialId = base64UrlToBuffer(storedCredentialId);
        const prfSecret = await getPasskeyAssertion(credentialId);
        this.signer = await this.deriveSigner(credentialId, prfSecret, storedAddress);
        this.startSession(prfSecret);

        return { publicKey: storedAddress, network: STELLAR_NETWORK.name.toLowerCase() };
      }

      return await this.firstRun();
    } catch (err) {
      if (err instanceof WalletError) throw err;
      if (err instanceof PasskeyError) {
        if (err.code === 'PRF_UNSUPPORTED') {
          throw new WalletError(err.message, 'NOT_AVAILABLE', 'passkey');
        }
        if (err.code === 'USER_REJECTED') {
          throw new WalletError(err.message, 'USER_REJECTED', 'passkey');
        }
        throw new WalletError(err.message, 'CONNECT_FAILED', 'passkey');
      }
      throw new WalletError(`Passkey connect failed: ${String(err)}`, 'CONNECT_FAILED', 'passkey');
    }
  }

  /**
   * Create-or-import a smart account: register a fresh passkey, deploy its
   * Soroban smart account, and fund it via friendbot on testnet so it can
   * pay its own fees immediately. Never touches a browser extension.
   */
  private async firstRun(): Promise<ConnectResult> {
    const userSuffix = bufferToBase64Url(crypto.getRandomValues(new Uint8Array(6)));
    const { credentialId, prfSecret } = await createPasskeyCredential({
      rpId: window.location.hostname,
      rpName: RP_NAME,
      userName: `wraith-${userSuffix}`,
    });

    this.signer = await this.deriveSigner(credentialId, prfSecret, null);
    const address = this.signer.getAddress();

    if (STELLAR_NETWORK.name.toLowerCase().includes('testnet')) {
      try {
        await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(address)}`);
      } catch {
        // Funding is best-effort — the account still exists, it just has no
        // balance yet. The receive/send flows surface that as a normal
        // insufficient-balance error rather than a connect failure.
      }
    }

    localStorage.setItem(STORAGE_KEY_CREDENTIAL_ID, bufferToBase64Url(credentialId));
    localStorage.setItem(STORAGE_KEY_ADDRESS, address);
    this.startSession(prfSecret);

    return { publicKey: address, network: STELLAR_NETWORK.name.toLowerCase() };
  }

  private async deriveSigner(
    credentialId: Uint8Array,
    prfSecret: Uint8Array,
    knownAddress: string | null,
  ): Promise<PasskeySigner> {
    const { WebAuthnPasskeyStealthSigner } = await import(
      /* webpackChunkName: "passkey-signer" */
      '@wraith-protocol/sdk/chains/stellar'
    );

    const signer = new WebAuthnPasskeyStealthSigner({
      networkPassphrase: STELLAR_NETWORK.networkPassphrase,
      rpcUrl: STELLAR_NETWORK.rpcUrl,
      credentialId,
      prfSecret,
    }) as unknown as PasskeySigner;

    if (!knownAddress && typeof signer.deploySmartAccount === 'function') {
      await signer.deploySmartAccount();
    }

    return signer;
  }

  private startSession(secret: Uint8Array): void {
    this.session = { secret, createdAt: Date.now(), signatureCount: 0 };
  }

  async signTransaction(xdr: string, _opts: SignOpts = {}): Promise<SignResult> {
    if (!this.signer) {
      throw new WalletError('No passkey session — connect first.', 'SIGN_FAILED', 'passkey');
    }

    if (!isSessionValid(this.session)) {
      const storedCredentialId = localStorage.getItem(STORAGE_KEY_CREDENTIAL_ID);
      const storedAddress = localStorage.getItem(STORAGE_KEY_ADDRESS);
      if (!storedCredentialId || !storedAddress) {
        throw new WalletError(
          'Passkey session expired and no stored credential was found.',
          'SIGN_FAILED',
          'passkey',
        );
      }

      try {
        const credentialId = base64UrlToBuffer(storedCredentialId);
        const prfSecret = await getPasskeyAssertion(credentialId);
        this.signer = await this.deriveSigner(credentialId, prfSecret, storedAddress);
        this.startSession(prfSecret);
      } catch (err) {
        if (err instanceof PasskeyError && err.code === 'USER_REJECTED') {
          throw new WalletError(err.message, 'USER_REJECTED', 'passkey');
        }
        throw new WalletError(
          `Passkey re-authentication failed: ${String(err)}`,
          'SIGN_FAILED',
          'passkey',
        );
      }
    }

    try {
      const result = await this.signer.signTransaction(xdr);
      if (this.session) this.session.signatureCount += 1;
      return { signedXdr: result.signedXdr };
    } catch (err) {
      throw new WalletError(`Passkey sign failed: ${String(err)}`, 'SIGN_FAILED', 'passkey');
    }
  }

  async disconnect(): Promise<void> {
    this.session = null;
    this.signer = null;
    // Deliberately keeps the persisted credential id / address — the
    // passkey itself lives in the platform authenticator and re-connecting
    // should not force the user through the first-run flow again.
  }
}
