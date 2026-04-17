# Wraith Protocol Demo

You are building a minimal demo web app for the Wraith Protocol stealth address SDK. This app shows developers how to integrate stealth payments using `@wraith-protocol/sdk` directly — no agent platform, no API keys, no backend.

## What This App Does

A single-page app with two functions: **Send** and **Receive** stealth payments. Supports four chains: Horizen (EVM), Stellar, Solana, and CKB (Nervos). A dropdown chain selector in the header switches between them.

This is NOT a full product. It's a reference implementation that developers study to understand how the SDK works in a real app.

## Reference Code

- `reference/horizen-web/` — Working Horizen stealth transfer web app (wagmi + RainbowKit)
- `reference/stellar-web/` — Working Stellar stealth transfer web app (Freighter)
- `reference/sdk-src/` — The SDK source code to understand exact imports and types
- `reference/docs/` — Implementation specs

Read the reference web apps to understand the existing UX patterns. The demo should combine both into one unified app.

## Stack

- Vite + React 19 + TypeScript
- Tailwind CSS (dark monochrome design system)
- wagmi v2 + RainbowKit (EVM wallet connection)
- @stellar/freighter-api (Stellar wallet connection)
- @solana/web3.js (Solana via Phantom browser wallet)
- @noble/curves + @noble/hashes (ed25519 primitives for Solana/CKB stealth)
- @wraith-protocol/sdk (installed from npm)
- React Router (two routes: /send and /receive)

## Design System

Same dark palette as all Wraith products:

| Token              | Hex       |
| ------------------ | --------- |
| surface            | `#0e0e0e` |
| surface-container  | `#141414` |
| surface-bright     | `#1a1a1a` |
| primary            | `#c6c6c7` |
| on-surface         | `#e6e1e5` |
| on-surface-variant | `#c4c7c5` |
| outline            | `#767575` |
| outline-variant    | `#444444` |
| error              | `#ee7d77` |
| tertiary           | `#22c55e` |

Fonts: Space Grotesk (headings), Inter (body), JetBrains Mono (code/mono).
No border radius anywhere. Sharp corners.

The UI should be minimal and clean — not a dashboard, not flashy. Think: a developer tool demo page. Generous whitespace, clear labels, code-like presentation of addresses and keys.

## Pages

### Header (all pages)

- Wraith logo + "WRAITH DEMO" text
- Chain switcher: dropdown selector — Horizen, Stellar, Solana, CKB.
- Wallet connect button: RainbowKit when Horizen, Freighter when Stellar, Phantom when Solana, manual key input label when CKB.
- Nav links: Send | Receive

### Send Page (`/send`)

**Horizen (EVM) mode:**

1. Recipient meta-address input (`st:eth:0x...` or `.wraith` name)
2. Amount input (ETH)
3. "Send" button
4. On click:
   - If .wraith name: use `buildResolveName` to get meta-address (or resolve via publicClient.call)
   - Use `buildSendStealth()` from SDK — returns `{ transaction, stealthAddress, ephemeralPubKey, viewTag }`
   - Submit transaction via wagmi's `useSendTransaction`
5. Show result: stealth address, tx hash with explorer link

**Stellar mode:**

1. Recipient meta-address input (`st:xlm:...`)
2. Amount input (XLM)
3. "Send" button
4. On click:
   - Use `generateStealthAddress()` from SDK
   - Build Stellar `createAccount` transaction
   - Sign with Freighter
   - Submit to Horizon
   - Call Soroban announcer contract
5. Show result: stealth address (G...), tx hash

**Solana mode:**

1. Recipient meta-address input (`st:sol:...`)
2. Amount input (SOL)
3. "Send" button
4. On click:
   - Use `generateStealthAddress()` from local stealth lib
   - Build Solana `SystemProgram.transfer` transaction
   - Sign with Phantom
   - Submit to Solana Devnet
5. Show result: stealth address (base58), tx signature

**CKB mode:**

1. Recipient meta-address input (`st:ckb:...`)
2. Amount input (CKB)
3. "Generate Stealth Cell" button
4. On click:
   - Use `generateStealthAddress()` from local stealth lib
   - Show stealth address, lockArgs (ephemeral pubkey + view tag + stealth pubkey)
   - User creates the Cell manually (CKB wallet integration pending)
5. Show result: stealth address, lockArgs, ephemeral pubkey, view tag

### Receive Page (`/receive`)

**All chains:**

1. "Derive Keys" button — signs the STEALTH_SIGNING_MESSAGE with connected wallet
2. Shows the user's stealth meta-address (copyable)
3. "Scan for Payments" button — calls `fetchAnnouncements()` / `scanStealthCells()`
4. Shows list of detected stealth payments with balances
5. Each payment has a "Withdraw" button
6. Withdraw: enter destination address, sends funds out

**Horizen withdraw:**

- Derive stealth private key from matched announcement
- Use `privateKeyToAccount()` + `sendTransaction()` via viem
- Show tx hash with explorer link

**Stellar withdraw:**

- Derive stealth private scalar from matched announcement
- Build payment transaction, sign with `signStellarTransaction()`
- Submit to Horizon
- Show tx hash

**Solana withdraw:**

- Derive stealth private scalar from matched announcement
- Build Solana transfer, sign with `signSolanaTransaction()`
- Submit to Solana Devnet
- Show tx signature

**CKB withdraw:**

- Derive stealth private scalar from matched stealth cell
- Show private key for manual withdrawal via ckb-cli
- CKB wallet integration pending

## SDK Imports

The demo uses the SDK for EVM and Stellar, with local implementations for Solana and CKB:

```typescript
// EVM
import {
  deriveStealthKeys,
  generateStealthAddress,
  scanAnnouncements,
  fetchAnnouncements,
  buildSendStealth,
  buildRegisterMetaAddress,
  getDeployment,
  STEALTH_SIGNING_MESSAGE,
  SCHEME_ID,
} from '@wraith-protocol/sdk/chains/evm';

// Stellar
import {
  deriveStealthKeys,
  generateStealthAddress,
  scanAnnouncements,
  fetchAnnouncements,
  getDeployment,
  STEALTH_SIGNING_MESSAGE,
  SCHEME_ID,
  bytesToHex,
} from '@wraith-protocol/sdk/chains/stellar';

// Solana (local primitives — SDK module planned)
import {
  deriveStealthKeys,
  generateStealthAddress,
  scanAnnouncements,
  signSolanaTransaction,
  STEALTH_SIGNING_MESSAGE,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
} from '@/lib/solana-stealth';

// CKB (local primitives — SDK module planned)
import {
  deriveStealthKeys,
  generateStealthAddress,
  scanStealthCells,
  STEALTH_SIGNING_MESSAGE,
  encodeStealthMetaAddress,
  decodeStealthMetaAddress,
} from '@/lib/ckb-stealth';
```

## Implementation Steps

Commit after each step. Push after each step.

### Step 1 — Scaffold

- Vite + React + TypeScript project
- Tailwind with design system colors
- package.json with `@wraith-protocol/sdk`, `wagmi`, `@rainbow-me/rainbowkit`, `@stellar/freighter-api`, `viem`, `@tanstack/react-query`, `react-router-dom`
- Prettier, commitlint, husky, CI workflow
- Google Fonts (Inter, Space Grotesk, JetBrains Mono)
- index.html with proper title and meta
- README.md
- CLAUDE.md committed

### Step 2 — Layout and Chain Switching

- Header with logo, chain switcher, wallet connect, nav
- Chain context: stores active chain ("horizen" | "stellar" | "solana" | "ckb")
- Wallet providers: RainbowKit for EVM, Freighter for Stellar, Phantom for Solana
- wagmi config with Horizen testnet chain
- Only show the relevant wallet button for the active chain
- Two routes: `/send` and `/receive`

### Step 3 — Send Page (Horizen)

- Meta-address input
- Amount input
- Build transaction with `buildSendStealth()`
- Submit via wagmi `useSendTransaction` or `useWriteContract`
- Show stealth address + tx result
- Error handling

### Step 4 — Send Page (Stellar)

- Meta-address input
- Amount input
- Generate stealth address with SDK
- Build Stellar transaction (createAccount)
- Sign with Freighter
- Submit to Horizon
- Announce via Soroban
- Show result

### Step 5 — Receive Page (Horizen)

- Derive keys button (sign with wallet via wagmi)
- Show meta-address
- Scan button: `fetchAnnouncements("horizen")` + `scanAnnouncements()`
- List payments with balances (fetch via viem publicClient)
- Withdraw: derive stealth private key, send funds to destination

### Step 6 — Receive Page (Stellar)

- Derive keys button (sign with Freighter)
- Show meta-address
- Scan button: `fetchAnnouncements("stellar")` + `scanAnnouncements()`
- List payments with balances (fetch from Horizon)
- Withdraw: derive scalar, sign tx, submit

## Final Structure

```
demo/
  package.json
  vite.config.ts
  tsconfig.json
  tailwind.config.ts
  index.html
  .prettierrc
  .github/workflows/ci.yml
  README.md
  CLAUDE.md
  src/
    main.tsx
    App.tsx
    index.css
    config.ts                   — wagmi config, chain definitions
    context/
      ChainContext.tsx           — active chain state
    components/
      Header.tsx                — logo, chain switcher, wallet, nav
      ChainSwitcher.tsx         — 4-chain dropdown selector
      WalletConnect.tsx         — conditional wallet per chain
      HorizenSend.tsx           — Horizen EVM send
      HorizenReceive.tsx        — Horizen EVM receive
      StellarSend.tsx           — Stellar send
      StellarReceive.tsx        — Stellar receive
      SolanaSend.tsx            — Solana send (Phantom)
      SolanaReceive.tsx         — Solana receive (Phantom)
      CkbSend.tsx              — CKB send (stealth cell generation)
      CkbReceive.tsx           — CKB receive (manual key input)
    lib/
      explorer.ts              — explorer URL helpers (all 4 chains)
      solana-stealth.ts        — ed25519 stealth primitives for Solana
      ckb-stealth.ts           — ed25519 stealth primitives for CKB
    pages/
      Send.tsx                  — unified send page, switches by chain
      Receive.tsx               — unified receive page, switches by chain
  reference/                    — DO NOT MODIFY
```

## Rules

- NEVER add Co-Authored-By lines to commits
- NEVER commit, modify, or delete anything in the reference/ folder — it is gitignored and read-only
- NEVER add numbered step comments in code
- All commit messages MUST follow conventional commits format
- Commit and push after each completed step
- Use `@wraith-protocol/sdk` from npm — do NOT copy SDK code
- Use the exact design system colors
- Keep it minimal — this is a demo, not a product
- No backend, no API keys, no agent client — pure SDK usage
- Show code-like presentation of addresses (font-mono, truncation, copy buttons)
