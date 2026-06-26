/**
 * src/wallets/stellar/LobstrAdapter.ts
 *
 * LOBSTR Signer adapter. LOBSTR is the most widely used Stellar wallet
 * by retail users (~3 M accounts). It provides a browser extension
 * signer and a QR-code mobile fallback.
 *
 * We use @creit.tech/stellar-wallets-kit (SWK) which wraps the raw
 * @lobstrco/signer-extension-api. SWK provides the same API surface
 * with better error normalisation, and since XBullAdapter already pulls
 * in SWK there is no additional bundle cost for LOBSTR support.
 */

import type { StellarWallet, ConnectResult, SignResult, SignOpts } from './types';
import { WalletError } from './types';

export class LobstrAdapter implements StellarWallet {
  readonly id = 'lobstr' as const;
  readonly name = 'LOBSTR';
  readonly icon = 'https://lobstr.co/static/img/lobstr-logo.svg';
  readonly installUrl = 'https://lobstr.co/signer';

  private async getKit() {
    const { StellarWalletsKit, WalletNetwork, LOBSTR_ID } = await import(
      /* webpackChunkName: "swk" */
      '@creit.tech/stellar-wallets-kit'
    );
    const kit = new StellarWalletsKit({
      network: WalletNetwork.TESTNET,
      selectedWalletId: LOBSTR_ID,
    });
    return { kit, LOBSTR_ID };
  }

  async isAvailable(): Promise<boolean> {
    try {
      // LOBSTR Signer extension injects window.lobstrSigner
      return typeof window !== 'undefined' && 'lobstrSigner' in window;
    } catch {
      return false;
    }
  }

  async connect(): Promise<ConnectResult> {
    try {
      const { kit } = await this.getKit();
      const { address } = await kit.getAddress();
      return { publicKey: address, network: 'testnet' };
    } catch (err) {
      const msg = String(err);
      if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('cancel')) {
        throw new WalletError('LOBSTR access denied by user', 'USER_REJECTED', 'lobstr');
      }
      throw new WalletError(`LOBSTR connect failed: ${msg}`, 'CONNECT_FAILED', 'lobstr');
    }
  }

  async signTransaction(xdr: string, opts: SignOpts = {}): Promise<SignResult> {
    try {
      const { kit } = await this.getKit();
      const { signedTxXdr } = await kit.signTransaction(xdr, {
        networkPassphrase: opts.networkPassphrase,
        address: opts.publicKey,
      });
      return { signedXdr: signedTxXdr };
    } catch (err) {
      const msg = String(err);
      if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('cancel')) {
        throw new WalletError('LOBSTR signing rejected', 'USER_REJECTED', 'lobstr');
      }
      throw new WalletError(`LOBSTR sign failed: ${msg}`, 'SIGN_FAILED', 'lobstr');
    }
  }

  async disconnect(): Promise<void> {
    try {
      const { kit } = await this.getKit();
      await kit.disconnect();
    } catch {
      // best-effort
    }
  }
}