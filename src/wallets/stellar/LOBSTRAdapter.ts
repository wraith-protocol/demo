/**
 * src/wallets/stellar/LOBSTRAdapter.ts
 *
 * LOBSTR wallet adapter. LOBSTR is primarily a mobile Stellar wallet.
 *
 * When the LOBSTR Signer browser extension is installed, it injects
 * a `window.lobstr` object — the adapter uses that for direct API access.
 *
 * When the extension is not available, the adapter provides deep-link URLs
 * that open the LOBSTR mobile app for signing. These deep-link URLs are
 * surfaced via the `getSignUrl()` and `getConnectUrl()` helper methods
 * so the UI can display them (e.g. as a QR code or direct link).
 *
 * LOBSTR can also be used via WalletConnect — that's handled by the
 * separate WalletConnectAdapter.
 *
 * Docs: https://lobstr.co/signer
 * Extension: https://github.com/Lobstrco/lobstr-browser-extension
 */

import type { StellarWallet, ConnectResult, SignResult, SignOpts } from './types';
import { WalletError } from './types';

interface LOBSTRDeepLinkOpts {
  /** The transaction XDR to sign (base64). */
  xdr?: string;
  /** The Stellar public key to sign with. */
  pubkey?: string;
  /** Network: 'testnet' or 'public'. */
  network?: string;
  /** Callback URL to return to after signing. */
  callback?: string;
}

/**
 * LOBSTR Signer base URL for deep-link flows.
 * The signer opens on mobile or in a web page that bridges to the app.
 */
const LOBSTR_SIGNER_BASE = 'https://lobstr.co/signer';

interface LOBSTRWindow {
  lobstr?: {
    connect(): Promise<{ publicKey: string }>;
    getPublicKey(): Promise<string>;
    signTransaction(xdr: string, opts?: { network?: string; publicKey?: string }): Promise<string>;
  };
}

declare const window: LOBSTRWindow;

export class LOBSTRAdapter implements StellarWallet {
  readonly id = 'lobstr' as const;
  readonly name = 'LOBSTR';
  readonly icon = 'https://lobstr.co/static/img/lobstr-logo.svg';
  readonly installUrl = 'https://lobstr.co/signer';

  async isAvailable(): Promise<boolean> {
    // Always available via web signer / deep-links even without extension.
    // The extension check happens inline in connect()/signTransaction().
    return true;
  }

  /** Check if the LOBSTR Signer extension is available. */
  private hasExtension(): boolean {
    return typeof window !== 'undefined' && !!window.lobstr;
  }

  async connect(): Promise<ConnectResult> {
    // Extension path
    const ext = this.hasExtension() ? window.lobstr : null;
    if (ext) {
      try {
        const result = await ext.connect();
        const publicKey = result.publicKey ?? '';

        if (!publicKey) {
          throw new WalletError('No public key returned from LOBSTR', 'CONNECT_FAILED', 'lobstr');
        }

        return { publicKey, network: 'testnet' };
      } catch (err) {
        if (err instanceof WalletError) throw err;
        throw new WalletError(`LOBSTR connect failed: ${String(err)}`, 'CONNECT_FAILED', 'lobstr');
      }
    }

    // Deep-link path — throw a specific error with the URL
    // so the UI can display a clickable link.
    throw new WalletError(this.getConnectUrl(), 'CONNECT_FAILED', 'lobstr');
  }

  async signTransaction(xdr: string, opts: SignOpts = {}): Promise<SignResult> {
    // Extension path
    const ext = this.hasExtension() ? window.lobstr : null;
    if (ext) {
      try {
        const network = opts.networkPassphrase?.includes('Public') ? 'public' : 'testnet';
        const signedXdr = await ext.signTransaction(xdr, {
          network,
          publicKey: opts.publicKey,
        });

        if (!signedXdr) {
          throw new WalletError('No signed XDR returned from LOBSTR', 'SIGN_FAILED', 'lobstr');
        }

        return { signedXdr };
      } catch (err) {
        if (err instanceof WalletError) throw err;
        const msg = String(err);
        if (msg.toLowerCase().includes('reject')) {
          throw new WalletError('LOBSTR signing rejected', 'USER_REJECTED', 'lobstr');
        }
        throw new WalletError(`LOBSTR sign failed: ${msg}`, 'SIGN_FAILED', 'lobstr');
      }
    }

    // Deep-link path — throw a specific error with the sign URL
    const network = opts.networkPassphrase?.includes('Public') ? 'public' : 'testnet';
    throw new WalletError(
      this.getSignUrl({
        xdr,
        pubkey: opts.publicKey,
        network,
      }),
      'SIGN_FAILED',
      'lobstr',
    );
  }

  async disconnect(): Promise<void> {
    // LOBSTR has no programmatic disconnect for the extension.
    // Clearing local session state is handled by the useStellarWallet hook.
  }

  // ── Deep-link URL helpers ──────────────────────────────────────────────────

  /**
   * Returns the LOBSTR signer URL for connecting.
   * The user opens this URL to connect their LOBSTR wallet.
   */
  getConnectUrl(): string {
    const callback = typeof location !== 'undefined' ? location.origin : '';
    return `${LOBSTR_SIGNER_BASE}?type=connect&callback=${encodeURIComponent(callback)}`;
  }

  /**
   * Returns the LOBSTR signer URL for signing a transaction via deep-link.
   * The UI can display this as a link or QR code for the user to open on mobile.
   */
  getSignUrl(opts: LOBSTRDeepLinkOpts = {}): string {
    const params = new URLSearchParams();
    if (opts.xdr) params.set('xdr', opts.xdr);
    if (opts.pubkey) params.set('pubkey', opts.pubkey);
    if (opts.network) params.set('network', opts.network);
    if (opts.callback) {
      params.set('callback', opts.callback);
    } else if (typeof location !== 'undefined') {
      params.set('callback', location.origin);
    }
    return `${LOBSTR_SIGNER_BASE}/tx?${params.toString()}`;
  }
}
