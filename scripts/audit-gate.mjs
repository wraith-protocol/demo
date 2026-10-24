#!/usr/bin/env node
// CI gate for production dependency audit findings.
//
// Runs `pnpm audit --prod`, compares the severity counts against the accepted
// baseline below and exits non-zero when the report regresses past it. The
// baseline mirrors docs/SECURITY_AUDIT.md, which documents every accepted
// transitive finding together with its owner and expiry date.
//
// An audit that does not return a successful result is treated as a failure.
// A registry error (`{"error": {...}}`), a non-JSON response, or a payload
// without `metadata.vulnerabilities` must never be mistaken for an audit with
// zero findings.
//
// Usage:
//   pnpm audit:gate
//   AUDIT_MAX_HIGH=2 pnpm audit:gate   # temporary override for a known bump
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// --- Accepted baseline (keep in sync with docs/SECURITY_AUDIT.md) -----------
// A new critical finding always fails CI: critical vulnerabilities are never
// accepted, only upgraded or removed.
export const MAX_CRITICAL = 0;
// High findings that currently have no patched release (see the doc).
export const MAX_HIGH = 2;
// ---------------------------------------------------------------------------

const SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info'];

export class AuditGateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuditGateError';
  }
}

function baselineFromEnv() {
  const override = process.env.AUDIT_MAX_HIGH;
  if (override === undefined || override === '') {
    return { critical: MAX_CRITICAL, high: MAX_HIGH };
  }
  const high = Number(override);
  if (!Number.isInteger(high) || high < 0) {
    throw new AuditGateError(
      `AUDIT_MAX_HIGH must be a non-negative integer, received "${override}".`,
    );
  }
  return { critical: MAX_CRITICAL, high };
}

/**
 * Turn the JSON report from `pnpm audit --prod --json` into severity counts.
 * Throws AuditGateError when the payload is not a successful audit result.
 */
export function summarizeAuditReport(report) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    throw new AuditGateError('pnpm audit did not return a JSON object.');
  }
  if (report.error) {
    const code = report.error.code ? ` (${report.error.code})` : '';
    const message = report.error.message ?? report.error.detail ?? 'unknown registry error';
    throw new AuditGateError(`pnpm audit reported an error${code}: ${message}`);
  }
  const vulnerabilities = report.metadata?.vulnerabilities;
  if (vulnerabilities === null || typeof vulnerabilities !== 'object') {
    throw new AuditGateError(
      'pnpm audit response is missing metadata.vulnerabilities; refusing to treat an unsuccessful audit as having no findings.',
    );
  }
  const summary = {};
  for (const severity of SEVERITIES) {
    const value = vulnerabilities[severity] ?? 0;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new AuditGateError(`pnpm audit reported a non-numeric ${severity} count.`);
    }
    summary[severity] = value;
  }
  return summary;
}

/** Parse the raw stdout produced by `pnpm audit --prod --json`. */
export function parseAuditStdout(stdout) {
  if (typeof stdout !== 'string' || stdout.trim() === '') {
    throw new AuditGateError('Could not read `pnpm audit --prod --json` output.');
  }
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    throw new AuditGateError('`pnpm audit --prod --json` did not return valid JSON.');
  }
  return summarizeAuditReport(report);
}

/** Human-readable regression for every severity above its accepted baseline. */
export function findRegressions(summary, baseline = { critical: MAX_CRITICAL, high: MAX_HIGH }) {
  return Object.entries(baseline)
    .filter(([severity, allowed]) => summary[severity] > allowed)
    .map(
      ([severity, allowed]) =>
        `${severity} findings ${summary[severity]} exceed the allowed ${allowed}`,
    );
}

function runProductionAudit() {
  const result = spawnSync('pnpm audit --prod --json', {
    encoding: 'utf8',
    shell: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    throw new AuditGateError(result.error.message);
  }
  return result.stdout ?? '';
}

export function main({
  run = runProductionAudit,
  baseline = baselineFromEnv(),
  log = console.log,
  error = console.error,
} = {}) {
  let summary;
  try {
    summary = parseAuditStdout(run());
  } catch (err) {
    if (!(err instanceof AuditGateError)) throw err;
    error(`\nDependency audit gate failed: ${err.message}`);
    error(
      '\nAn audit that does not return a successful result is treated as a failure. ' +
        'Check registry connectivity, then re-run `pnpm audit --prod --json`.',
    );
    return 1;
  }

  log(
    `Production audit: ${summary.critical} critical, ${summary.high} high, ` +
      `${summary.moderate} moderate, ${summary.low} low, ${summary.info} info`,
  );

  const regressions = findRegressions(summary, baseline);
  if (regressions.length > 0) {
    error('\nDependency audit gate failed:');
    for (const regression of regressions) error(`  - ${regression}`);
    error(
      '\nUpgrade the offending dependency. If no patched release exists yet, ' +
        'record the exception (owner + expiry) in docs/SECURITY_AUDIT.md and ' +
        'update the baseline here and in the doc together.',
    );
    return 1;
  }

  log('Dependency audit gate passed.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
