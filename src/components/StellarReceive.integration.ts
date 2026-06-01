/**
 * StellarReceive.tsx  — annotated integration patch
 *
 * This file shows the DIFF you need to apply to the existing StellarReceive
 * component to wire up the notification toggle.  It is not meant to replace
 * your file wholesale — merge the marked sections into your existing code.
 *
 * Changes summary:
 *   1. Import StellarNotificationToggle.
 *   2. Thread `signingOutput` (the raw hex from Freighter) through state so
 *      the notification hook can use it as the encryption KDF input.
 *   3. Render <StellarNotificationToggle> below the meta-address display,
 *      gated on keysReady.
 *
 * ── SEARCH FOR "NOTIFICATIONS PATCH" to find the three insertion points ──
 */

// ── NOTIFICATIONS PATCH 1 ── Add this import at the top of StellarReceive.tsx
import { StellarNotificationToggle } from '@/components/StellarNotificationToggle';

// ── NOTIFICATIONS PATCH 2 ── Add signingOutput to your existing state
// (already present if you stored the raw signature elsewhere — just surface it)
// const [signingOutput, setSigningOutput] = useState('');
//
// Inside your key-derivation handler, after calling Freighter's signMessage:
//
//   const { signature } = await signMessage(STEALTH_SIGNING_MESSAGE, { ...opts });
//   setSigningOutput(signature);   // ← persist so we can pass to the toggle
//   const { viewingKey, spendingKey } = deriveStealthKeys(signature);
//   // ... rest of existing code

// ── NOTIFICATIONS PATCH 3 ── Render the toggle in the JSX
// Place this block directly after the meta-address code block / copy button,
// and before the "Scan for Payments" button section:
//
//   {keysReady && (
//     <StellarNotificationToggle
//       viewingKeyHex={viewingKey}
//       spendingPubKeyHex={spendingPubKey}
//       signingOutput={signingOutput}
//       lastSeenCursor={lastSeenCursor}   // optional — avoids re-scanning old txs
//       keysReady={keysReady}
//     />
//   )}
//
// Where `keysReady` is the boolean you already use to gate the Scan button.

export {};