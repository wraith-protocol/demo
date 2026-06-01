/**
 * src/wallets/stellar/AlbedoAdapter.ts
 *
 * Albedo is a web-based Stellar signing service — no browser extension
 * required. Signing opens a popup at albedo.link.
 *
 * Package: @albedo-link/intent  (lazy-loaded)
 * Docs:    https://albedo.link/docs
 *
 * Availability: Albedo is always "available" because it is web-based.
 * We still keep isAvailable() consistent with the interface contract.
 */

import type { StellarWallet, ConnectResult, SignResult, SignOpts } from './types';
import { WalletError } from './types';

export class AlbedoAdapter implements StellarWallet {
  readonly id = 'albedo' as const;
  readonly name = 'Albedo';
  readonly icon = 'https://albedo.link/img/albedo-logo.svg';
  readonly installUrl = 'https://albedo.link';

  // Albedo is always available — it opens a web popup.
  async isAvailable(): Promise<boolean> {
    return true;
  }

  async connect(): Promise<ConnectResult> {
    try {
      const albedo = await import(
        /* webpackChunkName: "albedo" */
        '@albedo-link/intent'
      );

      // publicKey intent — prompts the user to authorise sharing their key.
      const result = await albedo.default.publicKey({
        require_existing: false,
      });

      return {
        publicKey: result.pubkey,
        // Albedo does not expose the network in the publicKey response;
        // we default to testnet for the demo. Production code should
        // verify via a test transaction or a network-specific session.
        network: 'testnet',
      };
    } catch (err) {
      const msg = String(err);
      // Albedo throws with message 'Rejected by user' on denial
      if (msg.toLowerCase().includes('reject')) {
        throw new WalletError('Albedo access denied by user', 'USER_REJECTED', 'albedo');
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

      const result = await albedo.default.tx({
        xdr,
        network: opts.networkPassphrase
          ? undefined            // albedo.tx accepts passphrase via `network`
          : 'TESTNET',
        pubkey: opts.publicKey,
        submit: false,          // we handle submission ourselves
      });

      return { signedXdr: result.signed_envelope_xdr };
    } catch (err) {
      const msg = String(err);
      if (msg.toLowerCase().includes('reject')) {
        throw new WalletError('Albedo signing rejected by user', 'USER_REJECTED', 'albedo');
      }
      throw new WalletError(`Albedo sign failed: ${msg}`, 'SIGN_FAILED', 'albedo');
    }
  }

  async disconnect(): Promise<void> {
    // Albedo is stateless — nothing to clear on our side.
  }
}