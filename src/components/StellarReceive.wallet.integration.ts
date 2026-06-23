/**
 * StellarReceive.wallet.integration.ts  (feat/stellar-multi-wallet)
 *
 * Three-point merge guide: how to wire useStellarWallet into the
 * existing StellarReceive.tsx to replace direct Freighter calls.
 *
 * Search for "── WALLET PATCH N ──" in your editor.
 */

// ── WALLET PATCH 1 ── Replace these existing imports:
//
//   import { requestAccess, signTransaction, getPublicKey }
//     from '@stellar/freighter-api';
//
// With:
import { useStellarWallet } from '@/hooks/useStellarWallet';
import { StellarWalletPicker } from '@/components/StellarWalletPicker';
import { StellarWalletButton } from '@/components/StellarWalletButton';

// ── WALLET PATCH 2 ── Inside the StellarReceive component function,
// replace the existing Freighter state + useEffect with:
//
//   const walletState = useStellarWallet();
//   const { publicKey, status, signTransaction, openPicker } = walletState;
//
// Replace every call to the Freighter API:
//   requestAccess()                 → walletState.connect(walletState.walletId!)
//   getPublicKey()                  → walletState.publicKey
//   freighterSignTx(xdr, opts)      → walletState.signTransaction(xdr, NETWORK_PASSPHRASE)

// ── WALLET PATCH 3 ── In the JSX, replace the old "Connect Freighter" button:
//
//   <StellarWalletButton state={walletState} />
//   <StellarWalletPicker state={walletState} />
//
// StellarWalletPicker renders null when pickerOpen=false, so it can sit
// anywhere in the component tree safely.

export {};