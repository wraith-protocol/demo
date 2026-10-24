# Dependency security audit

Tracking issue: [#223 — Remediate critical demo runtime dependency findings](https://github.com/wraith-protocol/demo/issues/223).

This document records how the production dependency audit for the demo is kept
healthy and lists every finding we knowingly accept, who owns it, and when it
must be re-checked. CI enforces the baseline described here.

## Policy

- **No critical findings are ever accepted.** `pnpm audit:gate` (run in CI)
  fails the build as soon as a critical production finding appears.
- Direct dependencies are kept on patched releases.
- When a transitive finding has no patched release (or upgrading would break a
  supported chain integration), it is recorded in [Accepted findings](#accepted-findings)
  with an owner and an expiry date instead of being silently ignored.
- The accepted baseline is small and is expected to shrink, never grow.

## Result

`pnpm audit --prod` before and after this remediation:

| Severity  | Before | After |
| --------- | -----: | ----: |
| Critical  |      1 |     0 |
| High      |     53 |     0 |
| Moderate  |     86 |     8 |
| Low       |      7 |     2 |
| **Total** |    147 |    10 |

All high findings have been remediated. The critical (`shell-quote`) was removed
by an override.

## How to run the audit

```bash
pnpm audit:prod   # human-readable production audit
pnpm audit:gate   # what CI enforces (exit non-zero on regression)
```

`pnpm audit:gate` runs `pnpm audit --prod --json`, compares the severity counts
against the baseline in `scripts/audit-gate.mjs`, and prints a summary. The gate
fails when the audit does not return a successful result — a registry error
(`{"error": {...}}`), non-JSON output, or a payload without
`metadata.vulnerabilities`. An unsuccessful audit is never read as zero
findings; `scripts/audit-gate.test.mjs` guards that regression.

## Remediation applied

### Direct dependencies upgraded

| Package                      | From              | To                | Why                                                    |
| ---------------------------- | ----------------- | ----------------- | ------------------------------------------------------ |
| `react-router-dom`           | `^7.6.0`          | `^7.18.4`         | Resolves the `react-router` advisories.                |
| `@stellar/stellar-sdk`       | `^13.1.0`         | `^13.3.0`         | Latest patched 13.x; avoids a breaking major API jump. |
| `@ckb-ccc/ccc`               | `^1.1.25`         | `^1.3.6`          | Patched 1.x line (CKB).                                |
| `wagmi`                      | `^2.14.0`         | `^2.19.5`         | Latest 2.x (RainbowKit 2.x is not compatible with v3). |
| `@rainbow-me/rainbowkit`     | `^2.2.0`          | `^2.2.11`         | Matches the wagmi 2.x line.                            |
| `viem`                       | `^2.23.0`         | `^2.57.7`         | Patched 2.x.                                           |
| `@solana/web3.js`            | `^1.98.4`         | `^1.99.0`         | Latest patched 1.x.                                    |
| `@solana/wallet-adapter-*`   | `0.9.27`/`0.9.29` | `0.9.28`/`0.9.30` | Latest patched adapters.                               |
| `@walletconnect/core`        | `^2.23.10`        | `^2.26.0`         | Latest patched 2.x.                                    |
| `@walletconnect/sign-client` | `^2.23.10`        | `^2.26.0`         | Latest patched 2.x.                                    |
| `@tanstack/react-query`      | `^5.64.0`         | `^5.104.3`        | Latest patched 5.x.                                    |

### Transitive dependencies forced via `pnpm.overrides`

Some findings live deep in the tree and are only reachable by forcing a patched
version with `pnpm.overrides` (see `package.json`). Except where noted, every
override stays within a range the consumer already declares, so runtime
behaviour is preserved:

| Override (package selector)                   | Forced to | Reported advisory                                                                                        |
| --------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------- |
| `axios`                                       | `1.20.0`  | Multiple GHSA advisories on the 1.x line.                                                                |
| `form-data`                                   | `4.0.6`   | GHSA-hmw2-7cc7-3qxx.                                                                                     |
| `follow-redirects`                            | `1.16.1`  | GHSA-q3jh-wrc6-jgq8, GHSA-8r9p-f939-6h3c.                                                                |
| `hono`                                        | `4.13.13` | Multiple GHSA advisories on the 4.x line.                                                                |
| `socket.io-parser`                            | `4.2.7`   | GHSA-2m8v-j782-fhvr.                                                                                     |
| `browserslist`                                | `4.29.3`  | GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g.                                                                |
| `metro>image-size`                            | `2.0.4`   | GHSA-5p2g-fcmc-qvqq, GHSA-w3rx-r6r6-pgpr.                                                                |
| `shell-quote`                                 | `1.12.0`  | GHSA-pqg4-j6r4-53mv (critical), GHSA-395f-4hp3-45gv.                                                     |
| `@stellar/stellar-sdk>toml`                   | `5.0.1`   | GHSA-82x6-q7mm-w9cf, GHSA-v5mp-jgw5-2x6j, GHSA-4qx8-w7c3-pj3p, GHSA-9j65-hcg3-gc64, GHSA-9qmh-m7c6-f92p. |
| `engine.io-client>ws`, `ethers>ws`, `viem>ws` | `8.22.0`  | GHSA-96hv-2xvq-fx4p, GHSA-58qx-3vcg-4xpx.                                                                |

Overrides that cross a declared major range are scoped to the single path that
needs them with pnpm's `parent>child` syntax, so they cannot silently change a
different consumer:

- **`ws` stays on the major each consumer declares.** The `^7` consumers
  (`jayson`, `metro`, `react-native`, `@react-native/dev-middleware`,
  `react-devtools-core`, `@walletconnect/jsonrpc-ws-connection`) resolve to the
  patched `7.5.13` from their own range. Only the exact/tilde-pinned `ws` 8
  consumers (`engine.io-client`, `ethers`, `viem`) are bumped, within major 8.
- **`image-size` has no patched release inside the major the consumer
  declares** (`image-size` 1.x), so that override does cross a major. It is
  scoped to `metro`, and `scripts/dependency-compatibility.test.mjs` exercises
  the affected path so the bump cannot regress silently.

The `toml` override is safe because `@stellar/stellar-sdk` only uses `toml`
inside `StellarToml.Resolver`, which the demo never calls (`@stellar/stellar-sdk`
is used for `rpc`, `xdr`, `Address` and transaction building only). The
compatibility test asserts that the installed `toml` still parses a valid
`stellar.toml` and still throws on malformed input. Likewise,
`scripts/dependency-compatibility.test.mjs` sizes a real PNG through the
`image-size` version `metro` resolves, and confirms the `ws` 7 consumers still
receive a constructable `ws` 7 module.

## Accepted findings

Everything below is transitive, has no patched release inside the range the
consumer declares, and would require a breaking major bump of a package we do
not control. All are accepted with an owner and an expiry; re-check on or before
the expiry.

| Package                | Severity | Advisory                                                      | Dependency path                                                                        | Owner                          | Expiry     |
| ---------------------- | -------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------ | ---------- |
| `uuid`                 | moderate | GHSA-w5hq-g745-h8pq                                           | `@solana/web3.js` → `jayson`/`rpc-websockets`; `wagmi` → `@metamask/utils`             | `@wraith-protocol/maintainers` | 2027-01-15 |
| `valibot`              | moderate | GHSA-5qjj-4xww-7phc                                           | `@ckb-ccc/connector-react` → `@ckb-ccc/connector` → `@ckb-ccc/ccc` → `@ckb-ccc/xverse` | `@wraith-protocol/maintainers` | 2027-01-15 |
| `decode-uri-component` | moderate | GHSA-vcc3-ghjq-m6fr                                           | `wagmi` → `@walletconnect/ethereum-provider` → `@reown/appkit` → `query-string`        | `@wraith-protocol/maintainers` | 2027-01-15 |
| `stream-json`          | moderate | GHSA-528h-pc64-c93x, GHSA-hqr4-qq8f-hg3x, GHSA-mjw6-4jj6-33hc | `@solana/web3.js` → `jayson` → `stream-json`                                           | `@wraith-protocol/maintainers` | 2027-01-15 |
| `elliptic`             | low      | GHSA-848j-6mx2-7j84                                           | `@ckb-ccc/ccc` → `@ckb-ccc/eip6963` → `@joyid/ckb` → `@nervosnetwork/ckb-sdk-utils`    | `@wraith-protocol/maintainers` | 2027-01-15 |
| `@babel/core`          | low      | GHSA-4x5r-pxfx-6jf8                                           | `@solana/wallet-adapter-react` → `react-native` → `@react-native/codegen`              | `@wraith-protocol/maintainers` | 2027-01-15 |

Notes:

## CI gate

`.github/workflows/ci.yml` runs `pnpm audit:gate` on every push and pull request
to `main`/`develop`. The gate lives in `scripts/audit-gate.mjs` and enforces the
baseline:

- **critical ≤ 0** — a new critical finding always fails CI.
- **high ≤ 0** — all high findings have been remediated; any new high finding
  fails CI.

Raising either baseline requires a matching entry (owner + expiry) in the table
above.

The gate also fails when `pnpm audit` itself does not succeed: a registry error,
non-JSON output, or a payload without `metadata.vulnerabilities` is treated as
a failing audit rather than an audit with no findings.

## Review cadence

Re-run `pnpm audit:prod` on or before each expiry date, upgrade where a patched
release now exists, and remove the corresponding override/exception.
