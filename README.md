# Wraith Protocol Demo

A minimal demo web app for the [Wraith Protocol](https://github.com/wraith-protocol) stealth address SDK. Shows developers how to integrate stealth payments using `@wraith-protocol/sdk` — no backend, no API keys.

Supports two chains:

- **Horizen** (EVM) — wagmi + RainbowKit
- **Stellar** — Freighter wallet

## Setup

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

## Build

```bash
pnpm build
```

## Stack

- Vite + React 19 + TypeScript
- Tailwind CSS
- wagmi v2 + RainbowKit
- @stellar/freighter-api
- @wraith-protocol/sdk
- React Router
