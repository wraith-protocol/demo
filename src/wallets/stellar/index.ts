/**
 * src/wallets/stellar/index.ts
 *
 * Wallet registry. Import the adapters lazily so each wallet's package
 * is only downloaded when the picker is first opened (or when the
 * persisted wallet is reconnected).
 *
 * Bundle constraint: each adapter chunk must be ≤ +15 KB gzipped over
 * the base bundle. Enforced by Vite's manualChunks config in vite.config.ts.
 */

export * from './types';

// Re-export adapters for direct use in tests
export { FreighterAdapter } from './FreighterAdapter';
export { WalletConnectAdapter } from './WalletConnectAdapter';
export { AlbedoAdapter } from './AlbedoAdapter';
export { XBullAdapter } from './XBullAdapter';
export { LOBSTRAdapter } from './LOBSTRAdapter';
export { PasskeyAdapter, PASSKEY_ICON } from './PasskeyAdapter';

import type { StellarWallet, WalletId } from './types';
import { PASSKEY_ICON } from './PasskeyAdapter';

/**
 * Returns a fresh adapter instance for the given wallet ID.
 * Import is synchronous here — the individual adapter files are the
 * lazy boundary (they import their SDK packages lazily inside methods).
 */
export function getAdapter(id: WalletId): StellarWallet {
  switch (id) {
    case 'walletconnect': {
      const { WalletConnectAdapter } = require('./WalletConnectAdapter');
      return new WalletConnectAdapter();
    }
    case 'freighter': {
      const { FreighterAdapter } = require('./FreighterAdapter');
      return new FreighterAdapter();
    }
    case 'albedo': {
      const { AlbedoAdapter } = require('./AlbedoAdapter');
      return new AlbedoAdapter();
    }
    case 'xbull': {
      const { XBullAdapter } = require('./XBullAdapter');
      return new XBullAdapter();
    }
    case 'lobstr': {
      const { LOBSTRAdapter } = require('./LOBSTRAdapter');
      return new LOBSTRAdapter();
    }
    case 'passkey': {
      const { PasskeyAdapter } = require('./PasskeyAdapter');
      return new PasskeyAdapter();
    }
    default: {
      const { FreighterAdapter } = require('./FreighterAdapter');
      return new FreighterAdapter();
    }
  }
}

/** All wallet IDs in display order. */
export const WALLET_IDS: WalletId[] = [
  'freighter',
  'albedo',
  'xbull',
  'lobstr',
  'walletconnect',
  'passkey',
];

/** Metadata used by the picker without instantiating adapters. */
export const WALLET_META: Record<WalletId, { name: string; icon: string; installUrl: string }> = {
  freighter: {
    name: 'Freighter',
    icon: 'https://raw.githubusercontent.com/stellar/freighter/main/extension/public/favicon-128.png',
    installUrl: 'https://www.freighter.app',
  },
  albedo: {
    name: 'Albedo',
    icon: 'https://albedo.link/img/albedo-logo.svg',
    installUrl: 'https://albedo.link',
  },
  xbull: {
    name: 'xBull',
    icon: 'https://xbull.app/assets/icons/icon-128x128.png',
    installUrl: 'https://xbull.app',
  },
  lobstr: {
    name: 'LOBSTR',
    icon: 'https://lobstr.co/static/img/lobstr-logo.svg',
    installUrl: 'https://lobstr.co/signer',
  },
  walletconnect: {
    name: 'WalletConnect',
    icon: 'https://walletconnect.com/walletconnect-logo.png',
    installUrl: 'https://walletconnect.com/explore',
  },
  passkey: {
    name: 'Passkey',
    icon: PASSKEY_ICON,
    installUrl: 'https://passkeys.dev/device-support/',
  },
};
