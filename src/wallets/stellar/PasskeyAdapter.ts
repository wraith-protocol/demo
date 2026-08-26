/**
 * src/wallets/stellar/PasskeyAdapter.ts
 *
 * Passkey wallet mode: no browser extension, no seed phrase. A user's
 * device passkey deterministically derives a Stellar signing key via the
 * WebAuthn PRF ceremony in src/lib/stellar/passkey.ts — the same key every
 * time, for the same passkey, without ever being written to disk.
 *
 * SCOPE NOTE — read before extending this file: the linked issue (#150)
 * describes a Soroban *smart* account with on-chain fee sponsorship and a
 * contract-delegated session key, via an SDK export
 * (`WebAuthnPasskeyStealthSigner`) referenced in the issue text. That export
 * does not exist in any version of @wraith-protocol/sdk published to npm —
 * checked every published version through the current latest, 1.4.5 — and a
 * real smart-contract account additionally needs a deployed Soroban wallet
 * contract (Rust/WASM) that doesn't exist anywhere in this repo. Neither is
 * buildable from this environment.
 *
 * This adapter instead ships a fully working, honestly-scoped-down version:
 * a classic Ed25519 Stellar account whose key is deterministically derived
 * from the passkey. It satisfies "no extension prompt, funds itself on
 * testnet, PRF-gated" end to end, using only real `@stellar/stellar-sdk`
 * APIs. Fee sponsorship and contract-delegated session keys are follow-up
 * work once a wallet contract exists to target — the "session" implemented
 * here is a client-side ceiling on how long the derived key stays resident
 * in memory (see SESSION_KEY_TTL_MS / SESSION_KEY_MAX_SIGNATURES in
 * passkey.ts), not an on-chain delegation.
 */

import { sha512 } from '@noble/hashes/sha512';
import { Keypair, Transaction } from '@stellar/stellar-sdk';
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

/**
 * Hashes the PRF secret once more before using it as an Ed25519 seed, so the
 * raw authenticator output is never used verbatim as key material.
 */
function deriveKeypairFromPrfSecret(prfSecret: Uint8Array): Keypair {
  const seed = sha512(prfSecret).slice(0, 32);
  return Keypair.fromRawEd25519Seed(Buffer.from(seed));
}

export class PasskeyAdapter implements StellarWallet {
  readonly id = 'passkey' as const;
  readonly name = 'Passkey';
  readonly icon = PASSKEY_ICON;
  readonly installUrl = 'https://passkeys.dev/device-support/';

  private session: PasskeySession | null = null;
  private keypair: Keypair | null = null;

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
        const keypair = deriveKeypairFromPrfSecret(prfSecret);

        if (keypair.publicKey() !== storedAddress) {
          throw new WalletError(
            'The derived key no longer matches the stored account — this passkey may have changed.',
            'CONNECT_FAILED',
            'passkey',
          );
        }

        this.keypair = keypair;
        this.startSession();
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
   * Create-or-import flow: register a fresh passkey, derive its Stellar
   * keypair from the PRF secret, and fund it via friendbot on testnet so it
   * can pay its own fees immediately. Never touches a browser extension.
   */
  private async firstRun(): Promise<ConnectResult> {
    const userSuffix = bufferToBase64Url(crypto.getRandomValues(new Uint8Array(6)));
    const { credentialId, prfSecret } = await createPasskeyCredential({
      rpId: window.location.hostname,
      rpName: RP_NAME,
      userName: `wraith-${userSuffix}`,
    });

    const keypair = deriveKeypairFromPrfSecret(prfSecret);
    const address = keypair.publicKey();

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
    this.keypair = keypair;
    this.startSession();

    return { publicKey: address, network: STELLAR_NETWORK.name.toLowerCase() };
  }

  private startSession(): void {
    this.session = { createdAt: Date.now(), signatureCount: 0 };
  }

  async signTransaction(xdr: string, opts: SignOpts = {}): Promise<SignResult> {
    if (!this.keypair) {
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
        this.keypair = deriveKeypairFromPrfSecret(prfSecret);
        this.startSession();
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
      const networkPassphrase = opts.networkPassphrase ?? STELLAR_NETWORK.networkPassphrase;
      const tx = new Transaction(xdr, networkPassphrase);
      tx.sign(this.keypair);
      if (this.session) this.session.signatureCount += 1;
      return { signedXdr: tx.toXDR() };
    } catch (err) {
      throw new WalletError(`Passkey sign failed: ${String(err)}`, 'SIGN_FAILED', 'passkey');
    }
  }

  async disconnect(): Promise<void> {
    this.session = null;
    this.keypair = null;
    // Deliberately keeps the persisted credential id / address — the
    // passkey itself lives in the platform authenticator and re-connecting
    // should not force the user through the first-run flow again.
  }
}
