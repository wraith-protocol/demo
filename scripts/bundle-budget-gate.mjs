#!/usr/bin/env node
// CI gate for production bundle size budgets (Wave 10, #219).
//
// Reads `dist/` after `pnpm build` and checks three things:
//   1. Initial load  — every chunk referenced synchronously from
//      dist/index.html (the `<script type="module">` entry plus any
//      `<link rel="modulepreload">` chunks). This is everything the browser
//      must fetch before the app shell can render; anything reachable only
//      through a dynamic import() is excluded by construction.
//   2. Scanner worker — src/workers/stellar-scanner.worker.ts, bundled as
//      its own standalone file (workers can't share chunks with the main
//      thread). It pulls in @stellar/stellar-sdk for XDR parsing, which is
//      already close to the practical floor for that dependency (see the
//      PR description for what was tried and why it didn't help further).
//   3. Per-chunk — every other chunk in dist/assets: lazy-loaded routes
//      (pages/*.tsx), lazy-loaded per-chain send/receive components, and
//      wagmi/RainbowKit's own internal per-wallet-connector chunks (e.g.
//      MetaMask SDK), which are dynamically imported by those libraries
//      and outside this app's chunking choices. Keeps any one chunk from
//      silently growing back into "the old monolith, just renamed."
//
// Usage:
//   pnpm build && pnpm build:budget-check
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// --- Budgets (bytes) ---------------------------------------------------
// Headroom above the measured baseline at the time this gate was added
// (see the PR this shipped in for the exact numbers), so this catches
// regressions without being so tight it flakes on routine minification
// differences between dependency patch versions.
export const INITIAL_LOAD_BUDGET_BYTES = 3_300_000; // ~3.3 MB
export const WORKER_BUDGET_BYTES = 1_100_000; // ~1.1 MB
// 750 KB covers the largest legitimate lazy chunk today (a wagmi/RainbowKit
// wallet-connector chunk at ~689 KB), which this app's own code doesn't
// control the size of; any lazy chunk this app does control (a page or a
// per-chain send/receive component) should stay well under this in practice.
export const PER_CHUNK_BUDGET_BYTES = 750_000;
// -------------------------------------------------------------------------

export class BundleBudgetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BundleBudgetError';
  }
}

/** Extract every same-origin script/modulepreload src from built index.html. */
export function extractInitialLoadPaths(html) {
  const paths = new Set();
  const tagPattern =
    /<(?:script[^>]*\stype="module"[^>]*\ssrc="([^"]+)"|link[^>]*\srel="modulepreload"[^>]*\shref="([^"]+)")/g;
  let match;
  while ((match = tagPattern.exec(html)) !== null) {
    const src = match[1] ?? match[2];
    if (src && !/^https?:\/\//.test(src)) paths.add(src);
  }
  return [...paths];
}

async function sizeOf(distDir, relativePath) {
  const cleaned = relativePath.replace(/^\/+/, '');
  const absolute = path.join(distDir, cleaned);
  try {
    const info = await stat(absolute);
    return info.size;
  } catch {
    throw new BundleBudgetError(`Referenced in index.html but not found on disk: ${cleaned}`);
  }
}

async function findWorkerFile(assetsDir) {
  const entries = await readdir(assetsDir);
  const worker = entries.find((name) => name.startsWith('stellar-scanner.worker-'));
  if (!worker) {
    throw new BundleBudgetError('Could not find the stellar-scanner.worker chunk in dist/assets.');
  }
  return worker;
}

function formatKb(bytes) {
  return `${(bytes / 1000).toFixed(1)} kB`;
}

export async function checkBudgets({
  distDir = path.resolve(process.cwd(), 'dist'),
  log = console.log,
} = {}) {
  const findings = [];
  const assetsDir = path.join(distDir, 'assets');

  // 1. Initial load
  const html = await readFile(path.join(distDir, 'index.html'), 'utf8');
  const initialPaths = extractInitialLoadPaths(html);
  if (initialPaths.length === 0) {
    throw new BundleBudgetError('No <script type="module"> entry found in dist/index.html.');
  }
  let initialLoadBytes = 0;
  for (const relativePath of initialPaths) {
    initialLoadBytes += await sizeOf(distDir, relativePath);
  }
  log(
    `Initial load: ${formatKb(initialLoadBytes)} across ${initialPaths.length} file(s) ` +
      `(budget ${formatKb(INITIAL_LOAD_BUDGET_BYTES)})`,
  );
  if (initialLoadBytes > INITIAL_LOAD_BUDGET_BYTES) {
    findings.push(
      `Initial load is ${formatKb(initialLoadBytes)}, over the ${formatKb(INITIAL_LOAD_BUDGET_BYTES)} budget.`,
    );
  }

  // 2. Scanner worker
  const workerFile = await findWorkerFile(assetsDir);
  const workerBytes = await sizeOf(distDir, `assets/${workerFile}`);
  log(
    `Scanner worker (${workerFile}): ${formatKb(workerBytes)} (budget ${formatKb(WORKER_BUDGET_BYTES)})`,
  );
  if (workerBytes > WORKER_BUDGET_BYTES) {
    findings.push(
      `${workerFile} is ${formatKb(workerBytes)}, over the ${formatKb(WORKER_BUDGET_BYTES)} worker budget.`,
    );
  }

  // 3. Every other chunk (lazy routes + lazy per-chain components)
  const initialBasenames = new Set(initialPaths.map((p) => path.basename(p)));
  const assetFiles = (await readdir(assetsDir)).filter(
    (name) => name.endsWith('.js') && name !== workerFile && !initialBasenames.has(name),
  );
  for (const file of assetFiles) {
    const bytes = await sizeOf(distDir, `assets/${file}`);
    if (bytes > PER_CHUNK_BUDGET_BYTES) {
      findings.push(
        `assets/${file} is ${formatKb(bytes)}, over the ${formatKb(PER_CHUNK_BUDGET_BYTES)} per-chunk budget.`,
      );
    }
  }
  log(`Checked ${assetFiles.length} additional chunk(s) against the per-chunk budget.`);

  return findings;
}

export async function main({ log = console.log, error = console.error } = {}) {
  let findings;
  try {
    findings = await checkBudgets({ log });
  } catch (err) {
    if (!(err instanceof BundleBudgetError)) throw err;
    error(`\nBundle budget gate failed: ${err.message}`);
    error('\nRun `pnpm build` first, then `pnpm build:budget-check`.');
    return 1;
  }

  if (findings.length > 0) {
    error('\nBundle budget gate failed:');
    for (const finding of findings) error(`  - ${finding}`);
    error(
      '\nEither lazy-load the offending code further, or — if the increase is ' +
        'deliberate and justified (a real new dependency, not a regression) — ' +
        'raise the relevant budget constant in scripts/bundle-budget-gate.mjs ' +
        'with a comment explaining why.',
    );
    return 1;
  }

  log('\nBundle budget gate passed.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
