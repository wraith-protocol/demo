# Contributing

Thanks for helping improve the Wraith Protocol demo. This guide covers local
development, Storybook, and the visual-regression workflow.

## Prerequisites

- **Node 20+**
- **pnpm 9** — this repo is pinned to pnpm via the committed `pnpm-lock.yaml`.
  The easiest way to get the right version is Corepack:

  ```bash
  corepack pnpm@9.15.9 install
  ```

  (Or `npm install -g pnpm@9.15.9`.) Later commands below assume `pnpm` resolves
  to v9.

## Running the app

```bash
pnpm install
pnpm dev          # Vite dev server
pnpm build        # tsc --noEmit + vite build
pnpm format       # Prettier write (format:check runs in CI + the pre-commit hook)
```

## Storybook

```bash
pnpm storybook        # dev server on http://localhost:6006
pnpm build-storybook  # static build into storybook-static/
```

Stories live **next to the component** they cover (e.g.
`src/components/StellarSend.stories.tsx`). No story may make a real network
request or talk to a wallet — see "Mocked contexts" below.

### Presentational / container convention

UI components are split into two layers so they can be developed in isolation:

- **View** (`*View.tsx`, `StellarMatchCard.tsx`, `FreighterConnectButton.tsx`) —
  pure and prop-driven. No `fetch`, no wallet, no context. Every visual state is
  reachable by passing props. **Write stories against these.**
- **Container** (`StellarSend.tsx`, `StellarReceive.tsx`, `WalletConnect.tsx`) —
  keeps the hooks, context reads, network calls and wallet signing, then renders
  the matching view.

When adding UI, put the markup in a view and the wiring in a container. That
keeps the story surface free of side effects.

### Mocked contexts

Decorators that supply fake context values live in `.storybook/decorators/`:

| Decorator              | Provides                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `withChain(chain)`     | `ChainContext` — the active chain (stateful)                                                            |
| `withStealthKeys(…)`   | `StealthKeysContext` — derived keys / meta-addresses                                                    |
| `withStellarWallet(…)` | `StellarWalletContext` — a connected/disconnected wallet with stubbed `signMessage` / `signTransaction` |

Reusable sample data (meta-address, stealth addresses, scalar, `makeMatches(n)`)
is in `.storybook/fixtures.ts`.

A container story that needs the network uses [MSW](https://mswjs.io) handlers
via the `msw` story parameter (see `StellarReceive.stories.tsx`) so requests are
intercepted instead of hitting a real endpoint.

Example — a pure view story:

```tsx
import type { Meta, StoryObj } from '@storybook/react';
import { StellarSendView } from './StellarSendView';

const meta = {
  title: 'Stellar/StellarSendView',
  component: StellarSendView,
  args: {
    /* … sensible defaults … */
  },
} satisfies Meta<typeof StellarSendView>;
export default meta;

export const Idle: StoryObj<typeof meta> = {};
```

## Visual-regression tests

Every story is rendered in headless Chromium by
[`@storybook/test-runner`](https://github.com/storybookjs/test-runner), its play
function is run, and a full-page screenshot is diffed against a committed
baseline in `__image_snapshots__/` (via `jest-image-snapshot`,
`.storybook/test-runner.ts`).

Locally, against a running Storybook:

```bash
pnpm build-storybook
pnpm exec concurrently -k -s first -n SB,TEST \
  "pnpm exec http-server storybook-static --port 6006 --silent" \
  "pnpm exec wait-on tcp:127.0.0.1:6006 && pnpm test-storybook --url http://127.0.0.1:6006"
```

### How CI uses baselines

The `Storybook` workflow runs inside the Playwright Docker image so that Chromium
and the system fonts are identical to how baselines were generated:

- **On a pull request** it verifies every story against the committed baselines
  in `__image_snapshots__/` and **fails on any diff**. To change the UI you must
  regenerate the baselines (below); the changed PNGs then show up in your PR for
  review.
- **On `main` or a manual run** it regenerates the baselines with `-u` and
  commits them back, so the canonical baselines always come from the CI
  environment.

### Updating baselines (important)

Screenshots are **environment-sensitive** — font rasterization differs between
operating systems, so baselines must be produced in the same environment CI uses.
Do **not** commit baselines produced by a bare `test-storybook` on your host
machine. Use one of these instead:

1. **GitHub (no Docker needed)** — push your branch, then run the **Storybook**
   workflow on it via _Actions → Storybook → Run workflow_. It regenerates the
   baselines in the canonical container and commits them back to your branch.

2. **Locally with Docker** — same image CI uses:

   ```bash
   docker run --rm \
     -v "$PWD":/work -v /work/node_modules -w /work \
     mcr.microsoft.com/playwright:v1.60.0-noble \
     bash -lc 'npm i -g pnpm@9.15.9 \
       && pnpm install --frozen-lockfile \
       && pnpm exec playwright install chromium \
       && pnpm build-storybook --quiet \
       && pnpm exec concurrently -k -s first -n SB,TEST \
          "pnpm exec http-server storybook-static --port 6006 --silent" \
          "pnpm exec wait-on tcp:127.0.0.1:6006 && pnpm test-storybook --url http://127.0.0.1:6006 -u"'
   ```

   The `-u` flag rewrites the baselines; review the diff and commit the updated
   PNGs under `__image_snapshots__/`.

When bumping the `playwright` dependency, update the image tag in
`.github/workflows/storybook.yml` **and** the command above together.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org)
(enforced by commitlint). The pre-commit hook runs `pnpm format:check`, so run
`pnpm format` before committing.
