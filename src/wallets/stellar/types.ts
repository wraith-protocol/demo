/**
 * src/wallets/stellar/types.ts
 *
 * Canonical interface every Stellar wallet adapter must implement.
 * All adapters return the same shapes so the rest of the app is
 * completely wallet-agnostic.
 */

export interface SignOpts {
  /** Stellar network passphrase. Defaults to testnet if omitted. */
  networkPassphrase?: string;
  /**
   * The public key that must sign. Some wallets use this to pick the
   * right account when the user has multiple.
   */
  publicKey?: string;
}

export interface ConnectResult {
  publicKey: string;
  /** Human-readable network name: 'testnet' | 'mainnet' | 'futurenet' */
  network: string;
}

export interface SignResult {
  signedXdr: string;
}

/**
 * StellarWallet — the single interface every adapter implements.
 *
 * Adapters are lazy-loaded (dynamic import) to keep the initial bundle
 * small. The `isAvailable()` check is always safe to call — it never
 * throws and resolves quickly.
 */
export interface StellarWallet {
  /** Stable, machine-readable identifier. Used as localStorage key. */
  readonly id: WalletId;
  /** Display name shown in the picker. */
  readonly name: string;
  /** Absolute URL to a square icon (svg or png, ≥ 64 px). */
  readonly icon: string;
  /** URL to the wallet's install page, shown when not detected. */
  readonly installUrl: string;

  /**
   * Returns true when the wallet extension / provider is available in
   * the current browser. Must never throw.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Prompts the user to connect and returns their public key + network.
   * Throws a WalletError on denial or timeout.
   */
  connect(): Promise<ConnectResult>;

  /**
   * Signs `xdr` with the user's key and returns the signed XDR string.
   * The output must be identical to what every other adapter produces
   * for the same input transaction — verified by unit tests.
   */
  signTransaction(xdr: string, opts?: SignOpts): Promise<SignResult>;

  /** Clears any local session / removes the persisted connection. */
  disconnect(): Promise<void>;
}

// ─── Wallet IDs ───────────────────────────────────────────────────────────────

export type WalletId = 'freighter' | 'albedo' | 'xbull' | 'lobstr' | 'walletconnect';

// ─── Error class ─────────────────────────────────────────────────────────────

export class WalletError extends Error {
  constructor(
    message: string,
    public readonly code: WalletErrorCode,
    public readonly walletId: WalletId,
  ) {
    super(message);
    this.name = 'WalletError';
  }
}

export type WalletErrorCode =
  | 'NOT_AVAILABLE'
  | 'USER_REJECTED'
  | 'NETWORK_MISMATCH'
  | 'SIGN_FAILED'
  | 'CONNECT_FAILED'
  | 'UNKNOWN';