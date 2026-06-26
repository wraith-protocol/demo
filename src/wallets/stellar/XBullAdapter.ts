/**
 * src/wallets/stellar/XBullAdapter.ts
 *
 * xBull Wallet adapter. xBull is a browser extension + web wallet.
 *
 * We use @creit.tech/stellar-wallets-kit's XBULL_ID entry here because
 * the raw @creit.tech/xbull-wallet-connect package provides the same
 * API surface that SWK already wraps — and SWK is already pulled in for
 * LobstrAdapter, so there is zero additional bundle cost.
 *
 * See PR description for the full Stellar Wallets Kit trade-off analysis.
 */

import type { StellarWallet, ConnectResult, SignResult, SignOpts } from './types';
import { WalletError } from './types';

export class XBullAdapter implements StellarWallet {
  readonly id = 'xbull' as const;
  readonly name = 'xBull';
  readonly icon = 'https://xbull.app/assets/icons/icon-128x128.png';
  readonly installUrl = 'https://xbull.app';

  private async getKit() {
    const { StellarWalletsKit, WalletNetwork, XBULL_ID } = await import(
      /* webpackChunkName: "swk" */
      '@creit.tech/stellar-wallets-kit'
    );
    const kit = new StellarWalletsKit({
      network: WalletNetwork.TESTNET,
      selectedWalletId: XBULL_ID,
    });
    return { kit, XBULL_ID };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { XBULL_ID } = await import(
        /* webpackChunkName: "swk" */
        '@creit.tech/stellar-wallets-kit'
      );
      // xBull injects window.xBullSDK when the extension is installed.
      return XBULL_ID !== undefined && typeof window !== 'undefined' && 'xBullSDK' in window;
    } catch {
      return false;
    }
  }

  async connect(): Promise<ConnectResult> {
    try {
      const { kit } = await this.getKit();
      await kit.openModal({ onWalletSelected: () => {} });
      const { address } = await kit.getAddress();
      return { publicKey: address, network: 'testnet' };
    } catch (err) {
      const msg = String(err);
      if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('cancel')) {
        throw new WalletError('xBull access denied by user', 'USER_REJECTED', 'xbull');
      }
      throw new WalletError(`xBull connect failed: ${msg}`, 'CONNECT_FAILED', 'xbull');
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
        throw new WalletError('xBull signing rejected', 'USER_REJECTED', 'xbull');
      }
      throw new WalletError(`xBull sign failed: ${msg}`, 'SIGN_FAILED', 'xbull');
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