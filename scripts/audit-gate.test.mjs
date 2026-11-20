import { describe, expect, it } from 'vitest';
import {
  AuditGateError,
  findRegressions,
  main,
  parseAuditStdout,
  summarizeAuditReport,
} from './audit-gate.mjs';

const OK_COUNTS = { critical: 0, high: 1, moderate: 8, low: 2, info: 0 };

function report(vulnerabilities) {
  return { metadata: { vulnerabilities } };
}

describe('summarizeAuditReport', () => {
  it('returns the severity counts from a successful audit', () => {
    expect(summarizeAuditReport(report(OK_COUNTS))).toEqual(OK_COUNTS);
  });

  it('defaults omitted severities to zero', () => {
    expect(summarizeAuditReport(report({ high: 1 }))).toMatchObject({
      critical: 0,
      high: 1,
      moderate: 0,
    });
  });

  it('rejects a payload without vulnerability metadata', () => {
    expect(() => summarizeAuditReport({})).toThrow(/metadata\.vulnerabilities/);
    expect(() => summarizeAuditReport({ metadata: {} })).toThrow(/metadata\.vulnerabilities/);
  });

  it('rejects non-object payloads', () => {
    expect(() => summarizeAuditReport(null)).toThrow(AuditGateError);
    expect(() => summarizeAuditReport([])).toThrow(AuditGateError);
    expect(() => summarizeAuditReport('boom')).toThrow(AuditGateError);
  });

  it('rejects non-numeric severity counts', () => {
    expect(() => summarizeAuditReport(report({ critical: '0' }))).toThrow(/non-numeric/);
  });
});

describe('parseAuditStdout', () => {
  it('parses valid audit JSON', () => {
    expect(parseAuditStdout(JSON.stringify(report(OK_COUNTS)))).toEqual(OK_COUNTS);
  });

  it('rejects empty output', () => {
    expect(() => parseAuditStdout('')).toThrow(AuditGateError);
    expect(() => parseAuditStdout('   \n')).toThrow(AuditGateError);
  });

  it('rejects non-JSON output', () => {
    expect(() => parseAuditStdout('Not Found')).toThrow(AuditGateError);
  });

  // Regression: `pnpm audit` emits a JSON error object when the registry is
  // unreachable. The old gate read `metadata.vulnerabilities ?? {}`, reported
  // zero findings and passed. A registry error must fail the gate.
  it('fails on a registry error payload instead of reporting zero findings', () => {
    const payload = JSON.stringify({
      error: {
        code: 'ERR_PNPM_AUDIT_BAD_RESPONSE',
        message: 'The audit endpoint responded with 503',
      },
    });
    expect(() => parseAuditStdout(payload)).toThrow(AuditGateError);
    expect(() => parseAuditStdout(payload)).toThrow(/503/);
  });
});

describe('findRegressions', () => {
  it('accepts a report within the baseline', () => {
    expect(findRegressions(OK_COUNTS, { critical: 0, high: 1 })).toEqual([]);
  });

  it('flags a new critical finding', () => {
    expect(findRegressions({ ...OK_COUNTS, critical: 1 }, { critical: 0, high: 1 })).toEqual([
      'critical findings 1 exceed the allowed 0',
    ]);
  });

  it('flags high findings above the accepted count', () => {
    expect(findRegressions({ ...OK_COUNTS, high: 3 }, { critical: 0, high: 1 })).toEqual([
      'high findings 3 exceed the allowed 1',
    ]);
  });
});

describe('main', () => {
  it('returns a non-zero exit code and explains a registry error', () => {
    const logs = [];
    const code = main({
      run: () =>
        JSON.stringify({
          error: {
            code: 'ERR_PNPM_AUDIT_BAD_RESPONSE',
            message: 'The audit endpoint responded with 503',
          },
        }),
      log: (message) => logs.push(message),
      error: (message) => logs.push(message),
    });
    expect(code).toBe(1);
    expect(logs.join('\n')).toMatch(/registry|503|successful result/i);
  });

  it('returns a non-zero exit code when findings regress', () => {
    const code = main({
      run: () => JSON.stringify(report({ ...OK_COUNTS, critical: 1 })),
      baseline: { critical: 0, high: 1 },
      log: () => {},
      error: () => {},
    });
    expect(code).toBe(1);
  });

  it('returns zero for a healthy audit', () => {
    const code = main({
      run: () => JSON.stringify(report(OK_COUNTS)),
      baseline: { critical: 0, high: 1 },
      log: () => {},
      error: () => {},
    });
    expect(code).toBe(0);
  });
});
