# Visual Regression Tests

The visual suite captures reachable transaction and recovery screens from the
real app. Wallet and network boundaries are deterministic fixtures; tests do
not assign state to globals the app does not read.

## Coverage

| Route               | State                                                                                                                    | Theme       | Viewports               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------- | ----------------------- |
| `/send`, `/receive` | Disconnected send and receive on Horizen, Stellar, Solana, and CKB                                                       | Light, dark | Desktop, mobile, tablet |
| `/send`             | CKB connected send form through the CCC connector's deterministic wallet                                                 | Light, dark | Desktop, mobile, tablet |
| `/send`             | Horizen, Stellar, and Solana pending, success, and wallet-rejection failure; Stellar form-filled and wrong-network modal | Light, dark | Desktop, mobile, tablet |
| `/receive`          | Horizen, Solana, and CKB derived meta-address and empty scan; Stellar derived meta-address and matched-payment scan      | Light, dark | Desktop, mobile, tablet |
| `/vault`            | Stellar vault deposit simulation, wallet signing, chain pending, success, and failure                                    | Light, dark | Desktop, mobile, tablet |
| `/names/auctions`   | Encrypted recovery vault unlocked; failed bid recovery with a safe retry                                                 | Light, dark | Desktop, mobile, tablet |

Simulation, signing, pending, success, and failure are the states implemented
by the Stellar vault deposit flow. The auction recovery test creates the
encrypted vault through the UI, submits a bid through the app, and drives the
wallet's real signing boundary to a deterministic rejection; the app persists
the failed bid and displays its retry-safe recovery state.

Horizen, Stellar, and Solana wallet-dependent states are driven through
injected providers and mocked chain RPCs. `installCkbWalletMock` supplies a
deterministic signer through the actual CCC connector's wallet-selection flow;
the app then calls its signer for key derivation and scans the SDK's CKB RPC
endpoint.
The CKB connected send form and empty receive scan are covered. CKB's
transaction-completion path is not represented: the real CCC transaction
builder requires client-provided funding cells, fee calculation, and signer
transaction submission. This fixture does not mock those CCC client internals,
so no CKB send success/failure or send-pending screenshot is claimed. CKB has no
vault, auction-recovery, or wrong-network screen. Its matched-cell withdrawal
is a manual private-key reveal for `ckb-cli`, not an in-app transaction flow.

## Deterministic fixtures

`e2e/visual-fixtures.ts` is the shared source for screenshot determinism:

- Freeze the browser clock at `2025-01-15T12:00:00Z`, while leaving timers
  functional.
- Seed browser randomness used for deterministic stealth data.
- Use fixed Stellar account balances and transaction results. Soroban
  responses for auction tests are constructed from the intercepted RPC method.
  Solana Devnet RPC and signature-subscription WebSocket confirmations are
  deterministic.
- Block unmocked external requests; the visual app serves its pinned font files
  locally from `public/fonts/`.
- Await the Inter, Space Grotesk, and JetBrains Mono font faces before capture.
- Enable reduced motion in Playwright and emulated media; suppress CSS
  animation, transition, and caret rendering.
- Start each test in light mode. Dark-mode tests click the real `Toggle theme`
  button and assert that the document enters dark mode.

The only masks are defined in `visualMasks` in `e2e/visual-fixtures.ts`:

1. The narrow transaction link (`a[href*="/tx/"]`) in successful transaction
   screenshots.
2. The exact vault deposit ID text in the vault success screenshot.

No page, panel, address field, or error is masked.

## Linux Docker commands

Docker Desktop and the Docker CLI must be available. The script reads the
resolved `@playwright/test` version from `pnpm-lock.yaml`, selects the matching
official `mcr.microsoft.com/playwright:v<version>-jammy` image, and mounts the
repository plus the named Linux `node_modules` volume. It never uses Windows
`node_modules`.

Run the suite:

```bash
pnpm test:visual:docker
```

Update baselines only after reviewing an intentional UI change:

```bash
pnpm test:visual:docker:update
```

Both commands build the app and run all three visual viewport projects inside
the pinned Linux image. The test-only `VITE_WRAITH_NAMES_CONTRACT_ID` points to
a valid Stellar contract ID; all auction RPC calls remain intercepted. Commit
only `*-linux.png` baselines. Do not generate or commit Windows snapshots.

Run one visual spec in the same container while developing:

```bash
pnpm test:visual:docker:spec e2e/visual-stellar-vault.spec.ts
```

## Review output and CI

Each test title names its route, state, and theme. A `visual-state` annotation
adds the viewport (`desktop`, `mobile`, or `tablet`), giving the full identity:

```text
/send | stellar-send-success | mobile | dark
```

Playwright's HTML report includes the screenshot comparison and its changed
region. On failure, the CI `visual-test-results` artifact contains
`playwright-report/` and `test-results/`, including actual, expected, and diff
images. Download the artifact and open `playwright-report/index.html`.

CI runs the same pinned Playwright Linux image as local baseline generation;
the visual job does not separately install a browser.

## Adding a visual state

1. Use a deterministic wallet/network fixture that the app actually consumes.
2. Navigate to the real route and perform the UI actions that reach the state.
3. Assert the intended state is visible before calling `captureVisual`.
4. Add `beginVisualCase` metadata with route, state, and theme; viewport comes
   from the Playwright project.
5. Add a narrow locator to the centralized `visualMasks` list only when a
   genuinely dynamic secret or hash must be hidden.
6. Generate and review Linux screenshots with
   `pnpm test:visual:docker:update`.
