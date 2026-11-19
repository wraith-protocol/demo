#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { findSecrets } from '../src/lib/secretPatterns.mjs';

export const DEFAULT_PATHS = Object.freeze([
  'test-results',
  'playwright-report',
  'blob-report',
  'reports',
  'artifacts',
]);

const SCANNABLE_EXTENSIONS = new Set([
  '.log',
  '.txt',
  '.json',
  '.jsonl',
  '.csv',
  '.tsv',
  '.html',
  '.htm',
  '.md',
  '.xml',
  '.yaml',
  '.yml',
  '.zip',
]);

const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.cache']);
const MAX_FILE_BYTES = 64 * 1024 * 1024;

export class SecretScanError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SecretScanError';
  }
}

function zipEntries(buffer) {
  const entries = [];
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    if (flags & 0x08 || compressedSize === 0 || start + compressedSize > buffer.length) break;
    const chunk = buffer.subarray(start, start + compressedSize);
    let text = '';
    if (method === 0) {
      text = chunk.toString('utf8');
    } else if (method === 8) {
      text = inflateRawSync(chunk).toString('utf8');
    }
    entries.push({ name, text });
    offset = start + compressedSize;
  }
  return entries;
}

function lineAt(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function structuredFindings(text, source) {
  const records = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('secret-finding')) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (value?.type !== 'secret-finding' || typeof value.id !== 'string') continue;
    records.push({
      source,
      id: value.id,
      label: typeof value.label === 'string' ? value.label : 'recorded secret finding',
      preview: typeof value.preview === 'string' ? value.preview : '[redacted]',
      line: 0,
    });
  }
  return records;
}

export function scanText(text, source) {
  const records = structuredFindings(text, source);
  for (const finding of findSecrets(text)) {
    records.push({
      source,
      id: finding.id,
      label: finding.label,
      preview: finding.preview,
      line: lineAt(text, finding.index),
    });
  }
  return records;
}

export function scanFile(filePath, source = filePath) {
  const buffer = readFileSync(filePath);
  if (buffer.length > MAX_FILE_BYTES) {
    throw new SecretScanError(`Artifact exceeds ${MAX_FILE_BYTES} bytes: ${filePath}`);
  }
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.zip') {
    return zipEntries(buffer).flatMap((entry) => scanText(entry.text, `${source}!${entry.name}`));
  }
  return scanText(buffer.toString('utf8'), source);
}

function collectFiles(root, explicit, issues) {
  if (!existsSync(root)) {
    if (explicit) issues.push(`Scan path does not exist: ${root}`);
    return [];
  }
  const stat = statSync(root);
  if (!stat.isDirectory()) return [root];

  const files = [];
  const queue = [root];
  while (queue.length > 0) {
    const directory = queue.shift();
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) queue.push(full);
      } else if (
        entry.isFile() &&
        SCANNABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        files.push(full);
      }
    }
  }
  return files;
}

export function scanPaths(paths, cwd = process.cwd(), requireAll = true) {
  const issues = [];
  const files = [];
  for (const entry of paths) {
    const target = path.resolve(cwd, entry);
    files.push(...collectFiles(target, requireAll, issues));
  }

  const findings = [];
  const scannedFiles = [];
  for (const file of files) {
    const source = path.relative(cwd, file) || file;
    try {
      findings.push(...scanFile(file, source));
      scannedFiles.push(source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push(`Could not scan ${source}: ${message}`);
    }
  }

  return {
    findings,
    scannedFiles,
    issues,
    clean: issues.length === 0 && findings.length === 0,
  };
}

export function formatReport(result) {
  const summary = `${result.findings.length} finding(s) across ${result.scannedFiles.length} file(s)`;
  const lines = [`Secret scan: ${summary}`];
  for (const finding of result.findings) {
    const location = finding.line ? `${finding.source}:${finding.line}` : finding.source;
    lines.push(`  ${location} ${finding.id} ${finding.preview}`);
  }
  for (const issue of result.issues) lines.push(`  ! ${issue}`);
  return lines.join('\n');
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const explicitPaths = argv.filter((arg) => !arg.startsWith('-'));
  const configured = env.SECRET_SCAN_PATHS?.split(':').filter(Boolean);
  const paths =
    explicitPaths.length > 0 ? explicitPaths : configured?.length ? configured : DEFAULT_PATHS;
  const result = scanPaths(paths, process.cwd(), paths !== DEFAULT_PATHS);
  const report = formatReport(result);

  if (argv.includes('--ci') && env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `clean=${result.clean ? 'true' : 'false'}\n`);
  }

  return { result, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { result, report } = main();
  console.log(report);
  if (!result.clean) process.exitCode = 1;
}
