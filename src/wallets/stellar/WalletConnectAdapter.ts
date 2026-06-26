/**
 * src/wallets/stellar/WalletConnectAdapter.ts
 *
 * WalletConnect v2 adapter for Stellar wallets.
 * Enables mobile wallet connections via QR code or deep link.
 *
 * Package: @walletconnect/sign-client (lazy-loaded)
 * Docs: https://docs.walletconnect.com/2.0/web/sign
 *
 * WalletConnect is always "available" since it works via QR/deep link
 * rather than requiring a browser extension.
 */

import type { StellarWallet, ConnectResult, SignResult, SignOpts } from './types';
import { WalletError } from './types';

// WalletConnect Stellar-specific methods
const STELLAR_METHODS = {
  SIGN: 'stellar_signAndSubmitXDR',
} as const;

const STELLAR_CHAINS = {
  TESTNET: 'stellar:testnet',
  PUBNET: 'stellar:pubnet',
} as const;

export class WalletConnectAdapter implements StellarWallet {
  readonly id = 'walletconnect' as const;
  readonly name = 'WalletConnect';
  readonly icon = 'https://walletconnect.com/walletconnect-logo.png';
  readonly installUrl = 'https://walletconnect.com/explore';

  private client: any = null;
  private session: any = null;
  private projectId = process.env.VITE_WALLETCONNECT_PROJECT_ID || '';

  // WalletConnect is always available — it uses QR/deep link
  async isAvailable(): Promise<boolean> {
    return true;
  }

  async connect(): Promise<ConnectResult> {
    try {
      // If we already have a session from startConnection, return it immediately
      if (this.session) {
        const accounts = this.session.namespaces.stellar?.accounts || [];
        if (accounts.length === 0) {
          throw new WalletError('No accounts in existing session', 'CONNECT_FAILED', 'walletconnect');
        }
        const account = accounts[0];
        const parts = account.split(':');
        const publicKey = parts[parts.length - 1];
        const network = parts[1] === 'stellar:pubnet' ? 'mainnet' : 'testnet';
        return { publicKey, network };
      }

      if (!this.projectId) {
        throw new WalletError(
          'WalletConnect project ID not configured. Set VITE_WALLETCONNECT_PROJECT_ID in your environment.',
          'CONNECT_FAILED',
          'walletconnect',
        );
      }

      const { SignClient } = await import(
        /* webpackChunkName: "walletconnect" */
        '@walletconnect/sign-client'
      );

      this.client = await SignClient.init({
        projectId: this.projectId,
        metadata: {
          name: 'Wraith Protocol Demo',
          description: 'Wraith Protocol - Privacy-preserving cross-chain transactions',
          url: typeof window !== 'undefined' ? window.location.origin : 'https://wraith-protocol.com',
          icons: ['https://walletconnect.com/walletconnect-logo.png'],
        },
      });

      // Create pairing proposal
      const { uri, approval } = await this.client.connect({
        requiredNamespaces: {
          stellar: {
            chains: [STELLAR_CHAINS.TESTNET],
            methods: [STELLAR_METHODS.SIGN],
            events: [],
          },
        },
      });

      // Store URI for the component to display BEFORE awaiting approval
      if (uri) {
        (this as any).pendingUri = uri;
      }

      // Wait for session approval
      this.session = await approval();

      // Extract public key from session
      const accounts = this.session.namespaces.stellar?.accounts || [];
      if (accounts.length === 0) {
        throw new WalletError('No accounts received from wallet', 'CONNECT_FAILED', 'walletconnect');
      }

      // Parse account format: "stellar:testnet:<publicKey>"
      const account = accounts[0];
      const parts = account.split(':');
      const publicKey = parts[parts.length - 1];
      const network = parts[1] === 'stellar:pubnet' ? 'mainnet' : 'testnet';

      return {
        publicKey,
        network,
      };
    } catch (err) {
      if (err instanceof WalletError) throw err;
      throw new WalletError(
        `WalletConnect connect failed: ${String(err)}`,
        'CONNECT_FAILED',
        'walletconnect',
      );
    }
  }

  /**
   * Start connection and return URI immediately without waiting for approval.
   * This allows the UI to display the QR code while the connection process continues.
   */
  async startConnection(): Promise<string> {
    try {
      if (!this.projectId) {
        throw new WalletError(
          'WalletConnect project ID not configured. Set VITE_WALLETCONNECT_PROJECT_ID in your environment.',
          'CONNECT_FAILED',
          'walletconnect',
        );
      }

      const { SignClient } = await import(
        /* webpackChunkName: "walletconnect" */
        '@walletconnect/sign-client'
      );

      this.client = await SignClient.init({
        projectId: this.projectId,
        metadata: {
          name: 'Wraith Protocol Demo',
          description: 'Wraith Protocol - Privacy-preserving cross-chain transactions',
          url: typeof window !== 'undefined' ? window.location.origin : 'https://wraith-protocol.com',
          icons: ['https://walletconnect.com/walletconnect-logo.png'],
        },
      });

      // Create pairing proposal
      const { uri, approval } = await this.client.connect({
        requiredNamespaces: {
          stellar: {
            chains: [STELLAR_CHAINS.TESTNET],
            methods: [STELLAR_METHODS.SIGN],
            events: [],
          },
        },
      });

      // Store URI and approval promise
      if (uri) {
        (this as any).pendingUri = uri;
      }
      (this as any).pendingApproval = approval;

      // Start approval in background
      approval.then((session: any) => {
        this.session = session;
      }).catch((err: Error) => {
        console.error('WalletConnect approval failed:', err);
      });

      return uri || '';
    } catch (err) {
      if (err instanceof WalletError) throw err;
      throw new WalletError(
        `WalletConnect connection start failed: ${String(err)}`,
        'CONNECT_FAILED',
        'walletconnect',
      );
    }
  }

  /**
   * Complete the connection after QR code scan.
   * This should be called after startConnection() and the user has approved.
   */
  async completeConnection(): Promise<ConnectResult> {
    try {
      // Wait for the pending approval to complete
      if ((this as any).pendingApproval) {
        this.session = await (this as any).pendingApproval;
      }

      if (!this.session) {
        throw new WalletError('No active session', 'CONNECT_FAILED', 'walletconnect');
      }

      // Extract public key from session
      const accounts = this.session.namespaces.stellar?.accounts || [];
      if (accounts.length === 0) {
        throw new WalletError('No accounts received from wallet', 'CONNECT_FAILED', 'walletconnect');
      }

      // Parse account format: "stellar:testnet:<publicKey>"
      const account = accounts[0];
      const parts = account.split(':');
      const publicKey = parts[parts.length - 1];
      const network = parts[1] === 'stellar:pubnet' ? 'mainnet' : 'testnet';

      return {
        publicKey,
        network,
      };
    } catch (err) {
      if (err instanceof WalletError) throw err;
      throw new WalletError(
        `WalletConnect connection completion failed: ${String(err)}`,
        'CONNECT_FAILED',
        'walletconnect',
      );
    }
  }

  /**
   * Check if the connection is ready (session established).
   * Returns true if the user has approved the connection.
   */
  isConnectionReady(): boolean {
    return !!this.session;
  }

  /**
   * Get the connection result if ready.
   * Returns null if not ready yet.
   */
  getConnectionResult(): ConnectResult | null {
    if (!this.session) return null;

    const accounts = this.session.namespaces.stellar?.accounts || [];
    if (accounts.length === 0) return null;

    const account = accounts[0];
    const parts = account.split(':');
    const publicKey = parts[parts.length - 1];
    const network = parts[1] === 'stellar:pubnet' ? 'mainnet' : 'testnet';

    return { publicKey, network };
  }

  async signTransaction(xdr: string, opts: SignOpts = {}): Promise<SignResult> {
    try {
      if (!this.client || !this.session) {
        throw new WalletError('WalletConnect session not established', 'SIGN_FAILED', 'walletconnect');
      }

      const chain = opts.networkPassphrase?.includes('Public') 
        ? STELLAR_CHAINS.PUBNET 
        : STELLAR_CHAINS.TESTNET;

      const result = await this.client.request({
        topic: this.session.topic,
        chainId: chain,
        request: {
          method: STELLAR_METHODS.SIGN,
          params: {
            xdr,
            network: opts.networkPassphrase,
            pubkey: opts.publicKey,
          },
        },
      });

      // WalletConnect wallets may return different formats
      // Some return signed XDR directly, others return an object
      const signedXdr = typeof result === 'string' ? result : result.signedXdr || result;

      if (!signedXdr) {
        throw new WalletError('No signed XDR returned from wallet', 'SIGN_FAILED', 'walletconnect');
      }

      return { signedXdr };
    } catch (err) {
      if (err instanceof WalletError) throw err;
      const msg = String(err);
      if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('user')) {
        throw new WalletError('WalletConnect signing rejected by user', 'USER_REJECTED', 'walletconnect');
      }
      throw new WalletError(`WalletConnect sign failed: ${msg}`, 'SIGN_FAILED', 'walletconnect');
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.client && this.session) {
        await this.client.disconnect({
          topic: this.session.topic,
          reason: { code: 6000, message: 'User disconnected' },
        });
      }
    } catch (err) {
      // Best-effort disconnect
      console.error('WalletConnect disconnect error:', err);
    } finally {
      this.client = null;
      this.session = null;
      (this as any).pendingUri = null;
    }
  }

  /**
   * Get the pending URI for QR code display.
   * This should be called after connect() is initiated but before approval.
   */
  getPendingUri(): string | null {
    return (this as any).pendingUri || null;
  }
}
