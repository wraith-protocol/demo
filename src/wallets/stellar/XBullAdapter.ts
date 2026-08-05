/**
 * src/wallets/stellar/XBullAdapter.ts
 *
 * xBull wallet adapter. xBull is a Stellar browser extension that injects
 * a `window.xbull` object into the page when installed. Uses the raw
 * xBull API directly — no extra package needed.
 *
 * Docs: https://xbull.app
 * Repo: https://github.com/Creit-Tech/xBull-Wallet
 */

import type { StellarWallet, ConnectResult, SignResult, SignOpts } from './types';
import { WalletError } from './types';

interface XBullExtension {
  connect(): Promise<{ publicKey: string }>;
  getPublicKey(): Promise<string>;
  signXDR(xdr: string): Promise<string>;
  signTransaction(xdr: string): Promise<string>;
  disconnect(): Promise<void>;
}

interface XBullWindow {
  xbull?: XBullExtension;
}

declare const window: XBullWindow;

export class XBullAdapter implements StellarWallet {
  readonly id = 'xbull' as const;
  readonly name = 'xBull';
  readonly icon = 'https://xbull.app/assets/icons/icon-128x128.png';
  readonly installUrl = 'https://xbull.app';

  async isAvailable(): Promise<boolean> {
    try {
      return typeof window !== 'undefined' && !!window.xbull;
    } catch {
      return false;
    }
  }

  async connect(): Promise<ConnectResult> {
    try {
      if (!window.xbull) {
        throw new WalletError('xBull extension not found', 'NOT_AVAILABLE', 'xbull');
      }

      const { publicKey } = await window.xbull.connect();

      if (!publicKey) {
        throw new WalletError('No public key returned from xBull', 'CONNECT_FAILED', 'xbull');
      }

      return { publicKey, network: 'testnet' };
    } catch (err) {
      if (err instanceof WalletError) throw err;
      const msg = String(err);
      if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('denied')) {
        throw new WalletError('xBull connection rejected by user', 'USER_REJECTED', 'xbull');
      }
      throw new WalletError(`xBull connect failed: ${msg}`, 'CONNECT_FAILED', 'xbull');
    }
  }

  async signTransaction(xdr: string, _opts: SignOpts = {}): Promise<SignResult> {
    try {
      if (!window.xbull) {
        throw new WalletError('xBull extension not found', 'NOT_AVAILABLE', 'xbull');
      }

      const signedXdr = await window.xbull.signXDR(xdr);

      if (!signedXdr) {
        throw new WalletError('No signed XDR returned from xBull', 'SIGN_FAILED', 'xbull');
      }

      return { signedXdr };
    } catch (err) {
      if (err instanceof WalletError) throw err;
      const msg = String(err);
      if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('denied')) {
        throw new WalletError('xBull signing rejected by user', 'USER_REJECTED', 'xbull');
      }
      throw new WalletError(`xBull sign failed: ${msg}`, 'SIGN_FAILED', 'xbull');
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (window.xbull) {
        await window.xbull.disconnect();
      }
    } catch {
      // Best-effort disconnect
    }
  }
}
