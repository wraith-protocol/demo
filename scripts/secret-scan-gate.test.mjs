import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main, scanPaths, scanText } from './secret-scan-gate.mjs';

const TX_HASH = `0x${'a'.repeat(64)}`;
const CANARY = 'WRAITH_CANARY_ABC123';
const directories = [];

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'secret-scan-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop(), { recursive: true, force: true });
});

describe('scanText', () => {
  it('fails on a deliberately logged canary but keeps transaction hashes readable', () => {
    const records = scanText(`[console.log] ${CANARY} tx=${TX_HASH}`, 'console.log');
    expect(records.map((record) => record.id)).toContain('canary');
    expect(records[0].source).toBe('console.log');
    expect(records[0].preview).not.toBe(CANARY);
  });

  it('accepts a published transaction hash and public address', () => {
    expect(scanText(`tx=${TX_HASH} to=0x${'b'.repeat(40)}`, 'export.csv')).toEqual([]);
  });

  it('detects a recorded finding even when the raw secret was redacted upstream', () => {
    const line = JSON.stringify({
      type: 'secret-finding',
      id: 'canary',
      label: 'seeded canary secret',
      source: 'console.log',
      preview: 'WRA…23',
    });
    expect(scanText(line, 'findings.jsonl').map((record) => record.id)).toContain('canary');
  });
});

describe('scanPaths', () => {
  it('scans console output, exports, and storage snapshots in one pass', () => {
    const directory = fixture();
    writeFileSync(path.join(directory, 'console.log'), `[console.error] ${CANARY}\n`);
    writeFileSync(path.join(directory, 'export.csv'), `timestamp,memo\nnow,${CANARY}\n`);
    writeFileSync(
      path.join(directory, 'storage.json'),
      JSON.stringify({ localStorage: { note: `spendingScalar ${CANARY}` } }),
    );
    writeFileSync(path.join(directory, 'indexeddb.json'), JSON.stringify({ key: CANARY }));
    writeFileSync(path.join(directory, 'clean.txt'), `tx=${TX_HASH}`);

    const result = scanPaths([directory]);
    expect(result.clean).toBe(false);
    const canaries = result.findings.filter((finding) => finding.id === 'canary');
    expect(canaries.length).toBeGreaterThanOrEqual(4);
    expect(result.scannedFiles).toHaveLength(5);
    expect(result.findings.some((finding) => finding.source.endsWith('clean.txt'))).toBe(false);
  });

  it('is clean when no artifact contains a secret', () => {
    const directory = fixture();
    writeFileSync(path.join(directory, 'clean.log'), `tx=${TX_HASH}\n`);
    const result = scanPaths([directory]);
    expect(result.clean).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('does not report a missing artifact directory as a clean scan', () => {
    const result = scanPaths([path.join(fixture(), 'missing')]);
    expect(result.clean).toBe(false);
    expect(result.issues[0]).toContain('does not exist');
  });
});

describe('main', () => {
  it('writes clean=false to GITHUB_OUTPUT when a canary is found', () => {
    const directory = fixture();
    const output = path.join(directory, 'github-output.txt');
    writeFileSync(path.join(directory, 'console.log'), CANARY);

    const { result } = main(['--ci'], {
      SECRET_SCAN_PATHS: directory,
      GITHUB_OUTPUT: output,
    });

    expect(result.clean).toBe(false);
    expect(readFileSync(output, 'utf8')).toContain('clean=false');
  });
});
