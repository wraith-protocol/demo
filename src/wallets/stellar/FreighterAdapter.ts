/**
 * src/wallets/stellar/FreighterAdapter.ts
 *
 * Wraps @stellar/freighter-api onto the StellarWallet interface.
 * This is the existing Freighter integration refactored to implement
 * the new abstraction — no behaviour changes.
 */

import type { StellarWallet, ConnectResult, SignResult, SignOpts } from './types';
import { WalletError } from './types';

export class FreighterAdapter implements StellarWallet {
  readonly id = 'freighter' as const;
  readonly name = 'Freighter';
  readonly icon =
    'https://raw.githubusercontent.com/stellar/freighter/main/extension/public/favicon-128.png';
  readonly installUrl = 'https://www.freighter.app';

  async isAvailable(): Promise<boolean> {
    try {
      const { isConnected } = await import(
        /* webpackChunkName: "freighter" */
        '@stellar/freighter-api'
      );
      const result = await isConnected();
      return result.isConnected;
    } catch {
      return false;
    }
  }

  async connect(): Promise<ConnectResult> {
    try {
      const { requestAccess, getNetwork } = await import(
        /* webpackChunkName: "freighter" */
        '@stellar/freighter-api'
      );

      const accessResult = await requestAccess();
      if ('error' in accessResult && accessResult.error) {
        throw new WalletError(
          `Freighter access denied: ${accessResult.error}`,
          'USER_REJECTED',
          'freighter',
        );
      }

      const networkResult = await getNetwork();
      const network = (networkResult as { network?: string }).network ?? 'testnet';

      return {
        publicKey: (accessResult as { address?: string }).address ?? '',
        network: network.toLowerCase(),
      };
    } catch (err) {
      if (err instanceof WalletError) throw err;
      throw new WalletError(
        `Freighter connect failed: ${String(err)}`,
        'CONNECT_FAILED',
        'freighter',
      );
    }
  }

  async signTransaction(xdr: string, opts: SignOpts = {}): Promise<SignResult> {
    try {
      const { signTransaction } = await import(
        /* webpackChunkName: "freighter" */
        '@stellar/freighter-api'
      );

      const result = await signTransaction(xdr, {
        networkPassphrase: opts.networkPassphrase,
        address: opts.publicKey,
      });

      if ('error' in result && result.error) {
        throw new WalletError(
          `Freighter sign rejected: ${result.error}`,
          'USER_REJECTED',
          'freighter',
        );
      }

      return { signedXdr: (result as { signedTxXdr?: string }).signedTxXdr ?? '' };
    } catch (err) {
      if (err instanceof WalletError) throw err;
      throw new WalletError(`Freighter sign failed: ${String(err)}`, 'SIGN_FAILED', 'freighter');
    }
  }

  async disconnect(): Promise<void> {
    // Freighter has no programmatic disconnect — clearing local state
    // is handled by the useStellarWallet hook.
  }
}
