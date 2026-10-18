import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BundleBudgetError,
  checkBudgets,
  extractInitialLoadPaths,
  INITIAL_LOAD_BUDGET_BYTES,
  PER_CHUNK_BUDGET_BYTES,
  WORKER_BUDGET_BYTES,
} from './bundle-budget-gate.mjs';

describe('extractInitialLoadPaths', () => {
  it('finds the module entry script', () => {
    const html = '<script type="module" crossorigin src="/assets/index-ABC123.js"></script>';
    expect(extractInitialLoadPaths(html)).toEqual(['/assets/index-ABC123.js']);
  });

  it('finds modulepreload links alongside the entry script', () => {
    const html = [
      '<link rel="modulepreload" href="/assets/vendor-XYZ.js">',
      '<script type="module" src="/assets/index-ABC.js"></script>',
    ].join('\n');
    expect(extractInitialLoadPaths(html)).toEqual([
      '/assets/vendor-XYZ.js',
      '/assets/index-ABC.js',
    ]);
  });

  it('ignores cross-origin scripts (e.g. analytics)', () => {
    const html = [
      '<script defer src="https://plausible.io/js/script.js"></script>',
      '<script type="module" src="/assets/index-ABC.js"></script>',
    ].join('\n');
    expect(extractInitialLoadPaths(html)).toEqual(['/assets/index-ABC.js']);
  });

  it('returns an empty array when there is no module entry', () => {
    expect(extractInitialLoadPaths('<html></html>')).toEqual([]);
  });
});

describe('checkBudgets', () => {
  let distDir;

  async function writeFixture({ entryBytes = 100, workerBytes = 100, extraChunks = {} } = {}) {
    distDir = await mkdtemp(path.join(tmpdir(), 'bundle-budget-'));
    await mkdir(path.join(distDir, 'assets'), { recursive: true });
    await writeFile(
      path.join(distDir, 'index.html'),
      '<script type="module" src="/assets/index-ABC.js"></script>',
    );
    await writeFile(path.join(distDir, 'assets', 'index-ABC.js'), 'x'.repeat(entryBytes));
    await writeFile(
      path.join(distDir, 'assets', 'stellar-scanner.worker-XYZ.js'),
      'x'.repeat(workerBytes),
    );
    for (const [name, bytes] of Object.entries(extraChunks)) {
      await writeFile(path.join(distDir, 'assets', name), 'x'.repeat(bytes));
    }
  }

  afterEach(async () => {
    if (distDir) await rm(distDir, { recursive: true, force: true });
  });

  it('passes with no findings when everything is under budget', async () => {
    await writeFixture({ extraChunks: { 'Vault-abc123.js': 1000 } });
    const findings = await checkBudgets({ distDir, log: () => {} });
    expect(findings).toEqual([]);
  });

  it('flags an over-budget initial load', async () => {
    await writeFixture({ entryBytes: INITIAL_LOAD_BUDGET_BYTES + 1 });
    const findings = await checkBudgets({ distDir, log: () => {} });
    expect(findings).toEqual([expect.stringContaining('Initial load')]);
  });

  it('flags an over-budget scanner worker', async () => {
    await writeFixture({ workerBytes: WORKER_BUDGET_BYTES + 1 });
    const findings = await checkBudgets({ distDir, log: () => {} });
    expect(findings).toEqual([expect.stringContaining('stellar-scanner.worker')]);
  });

  it('flags an over-budget lazy chunk', async () => {
    await writeFixture({
      extraChunks: { 'Portfolio-huge123.js': PER_CHUNK_BUDGET_BYTES + 1 },
    });
    const findings = await checkBudgets({ distDir, log: () => {} });
    expect(findings).toEqual([expect.stringContaining('Portfolio-huge123.js')]);
  });

  it('does not double-count the entry chunk as a lazy chunk', async () => {
    await writeFixture({ entryBytes: PER_CHUNK_BUDGET_BYTES + 1 });
    const findings = await checkBudgets({ distDir, log: () => {} });
    // Over the (much larger) initial-load budget only if huge enough to
    // also exceed INITIAL_LOAD_BUDGET_BYTES; here it shouldn't be flagged
    // as a *per-chunk* violation under its own entry filename.
    expect(findings.some((f) => f.includes('assets/index-ABC.js'))).toBe(false);
  });

  it('throws BundleBudgetError when the scanner worker chunk is missing', async () => {
    distDir = await mkdtemp(path.join(tmpdir(), 'bundle-budget-'));
    await mkdir(path.join(distDir, 'assets'), { recursive: true });
    await writeFile(
      path.join(distDir, 'index.html'),
      '<script type="module" src="/assets/index-ABC.js"></script>',
    );
    await writeFile(path.join(distDir, 'assets', 'index-ABC.js'), 'x');

    await expect(checkBudgets({ distDir, log: () => {} })).rejects.toThrow(BundleBudgetError);
  });

  it('throws BundleBudgetError when index.html has no module entry', async () => {
    distDir = await mkdtemp(path.join(tmpdir(), 'bundle-budget-'));
    await mkdir(path.join(distDir, 'assets'), { recursive: true });
    await writeFile(path.join(distDir, 'index.html'), '<html></html>');

    await expect(checkBudgets({ distDir, log: () => {} })).rejects.toThrow(BundleBudgetError);
  });
});
