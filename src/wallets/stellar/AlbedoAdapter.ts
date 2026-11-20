/**
 * src/wallets/stellar/AlbedoAdapter.ts
 *
 * Albedo wallet adapter. Albedo is a web-based Stellar wallet that works
 * via a popup flow — no browser extension required. Uses the
 * @albedo-link/intent SDK for all operations.
 *
 * Package: @albedo-link/intent (lazy-loaded)
 * Docs: https://github.com/stellar-expert/albedo
 */

import type { StellarWallet, ConnectResult, SignResult, SignOpts } from './types';
import { WalletError } from './types';

export class AlbedoAdapter implements StellarWallet {
  readonly id = 'albedo' as const;
  readonly name = 'Albedo';
  readonly icon = 'https://albedo.link/img/albedo-logo.svg';
  readonly installUrl = 'https://albedo.link';

  async isAvailable(): Promise<boolean> {
    try {
      await import(
        /* webpackChunkName: "albedo" */
        '@albedo-link/intent'
      );
      return true;
    } catch {
      return false;
    }
  }

  async connect(): Promise<ConnectResult> {
    try {
      const albedo = await import(
        /* webpackChunkName: "albedo" */
        '@albedo-link/intent'
      );

      const result = await albedo.default.publicKey({});
      const pubkey = result.pubkey ?? '';

      if (!pubkey) {
        throw new WalletError('No public key returned from Albedo', 'CONNECT_FAILED', 'albedo');
      }

      return {
        publicKey: pubkey,
        network: 'testnet',
      };
    } catch (err) {
      if (err instanceof WalletError) throw err;
      const msg = String(err);
      if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('reject')) {
        throw new WalletError('Albedo connection rejected by user', 'USER_REJECTED', 'albedo');
      }
      throw new WalletError(`Albedo connect failed: ${msg}`, 'CONNECT_FAILED', 'albedo');
    }
  }

  async signTransaction(xdr: string, opts: SignOpts = {}): Promise<SignResult> {
    try {
      const albedo = await import(
        /* webpackChunkName: "albedo" */
        '@albedo-link/intent'
      );

      const network = opts.networkPassphrase?.includes('Public') ? 'public' : 'testnet';

      const result = await albedo.default.tx({ xdr, network });
      const signedXdr = result.signed_envelope_xdr ?? '';

      if (!signedXdr) {
        throw new WalletError('No signed XDR returned from Albedo', 'SIGN_FAILED', 'albedo');
      }

      return { signedXdr };
    } catch (err) {
      if (err instanceof WalletError) throw err;
      const msg = String(err);
      if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('reject')) {
        throw new WalletError('Albedo signing rejected by user', 'USER_REJECTED', 'albedo');
      }
      throw new WalletError(`Albedo sign failed: ${msg}`, 'SIGN_FAILED', 'albedo');
    }
  }

  async disconnect(): Promise<void> {
    // Albedo has no persistent session — the popup flow is stateless.
  }
}
