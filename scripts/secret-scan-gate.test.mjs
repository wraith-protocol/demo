import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
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

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipWithDataDescriptor(name, text) {
  const nameBytes = Buffer.from(name, 'utf8');
  const plain = Buffer.from(text, 'utf8');
  const compressed = deflateRawSync(plain);
  const checksum = crc32(plain);

  const local = Buffer.alloc(30 + nameBytes.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x08, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(0, 18);
  local.writeUInt32LE(0, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);
  nameBytes.copy(local, 30);

  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(checksum, 4);
  descriptor.writeUInt32LE(compressed.length, 8);
  descriptor.writeUInt32LE(plain.length, 12);

  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x08, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(plain.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);
  nameBytes.copy(central, 46);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + compressed.length + descriptor.length, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([local, compressed, descriptor, central, end]);
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

describe('ZIP artifacts', () => {
  it('scans general-purpose flag bit 3 entries through the central directory', () => {
    const directory = fixture();
    const archive = path.join(directory, 'export.zip');
    writeFileSync(archive, zipWithDataDescriptor('memo.txt', `memo=${CANARY}`));

    const result = scanPaths([archive]);
    expect(result.issues).toEqual([]);
    expect(result.findings.map((finding) => finding.id)).toContain('canary');
    expect(result.findings.some((finding) => finding.source.endsWith('memo.txt'))).toBe(true);
  });

  it('scans ZIP bytes that are not part of a central-directory entry', () => {
    const directory = fixture();
    const archive = path.join(directory, 'export.zip');
    const bytes = zipWithDataDescriptor('clean.txt', `tx=${TX_HASH}`);
    writeFileSync(archive, Buffer.concat([bytes, Buffer.from(CANARY)]));

    const result = scanPaths([archive]);
    expect(result.findings.map((finding) => finding.id)).toContain('canary');
    expect(result.findings.some((finding) => finding.source.endsWith('raw'))).toBe(true);
  });

  it('fails closed on malformed ZIP artifacts', () => {
    const directory = fixture();
    const archive = path.join(directory, 'export.zip');
    writeFileSync(archive, Buffer.from('PK\x03\x04broken'));

    const result = scanPaths([archive]);
    expect(result.clean).toBe(false);
    expect(result.issues[0]).toContain('Malformed ZIP archive');
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
