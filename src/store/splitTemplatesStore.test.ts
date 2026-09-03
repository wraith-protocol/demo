import { describe, it, expect } from 'vitest';
import {
  resolveTemplateImport,
  templatesEqual,
  isValidTemplate,
  type SplitTemplate,
} from './splitTemplatesStore';

function makeTemplate(overrides: Partial<SplitTemplate> = {}): SplitTemplate {
  return {
    id: 'tpl_1',
    name: 'Payroll',
    rows: [
      { metaAddress: 'st:xlm:AAA', amountRaw: '10', memo: '' },
      { metaAddress: 'st:xlm:BBB', amountRaw: '5.5', memo: 'payment-1' },
    ],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// isValidTemplate
// ---------------------------------------------------------------------------

describe('isValidTemplate', () => {
  it('accepts a well-formed template', () => {
    expect(isValidTemplate(makeTemplate())).toBe(true);
  });

  it('accepts a template with rows that omit memo', () => {
    expect(
      isValidTemplate(makeTemplate({ rows: [{ metaAddress: 'st:xlm:AAA', amountRaw: '10' }] })),
    ).toBe(true);
  });

  it.each([
    ['null', null],
    ['not an object', 'nope'],
    ['missing id', { name: 'x', rows: [], createdAt: 1, updatedAt: 1 }],
    ['missing rows', { id: '1', name: 'x', createdAt: 1, updatedAt: 1 }],
    ['non-array rows', { id: '1', name: 'x', rows: 'nope', createdAt: 1, updatedAt: 1 }],
    [
      'row missing amountRaw',
      { id: '1', name: 'x', rows: [{ metaAddress: 'a' }], createdAt: 1, updatedAt: 1 },
    ],
  ])('rejects %s', (_label, value) => {
    expect(isValidTemplate(value)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// templatesEqual
// ---------------------------------------------------------------------------

describe('templatesEqual', () => {
  it('treats identical templates as equal', () => {
    expect(templatesEqual(makeTemplate(), makeTemplate())).toBe(true);
  });

  it('treats an empty memo and an omitted memo as equal', () => {
    const a = makeTemplate({ rows: [{ metaAddress: 'st:xlm:AAA', amountRaw: '10', memo: '' }] });
    const b = makeTemplate({ rows: [{ metaAddress: 'st:xlm:AAA', amountRaw: '10' }] });
    expect(templatesEqual(a, b)).toBe(true);
  });

  it('detects a name difference', () => {
    expect(templatesEqual(makeTemplate(), makeTemplate({ name: 'Vendors' }))).toBe(false);
  });

  it('detects a row difference', () => {
    const b = makeTemplate({ rows: [{ metaAddress: 'st:xlm:AAA', amountRaw: '999', memo: '' }] });
    expect(templatesEqual(makeTemplate(), b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveTemplateImport — export/import round trip (issue #155 acceptance)
// ---------------------------------------------------------------------------

describe('resolveTemplateImport', () => {
  it('round-trips a bare-array export back through import with no duplicates or conflicts', () => {
    const existing = [makeTemplate({ id: 'a' }), makeTemplate({ id: 'b', name: 'Vendors' })];
    const exported = JSON.stringify(existing);

    const result = resolveTemplateImport(existing, exported);

    expect(result.conflicts).toEqual([]);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(2);
    expect(result.next).toHaveLength(2);
  });

  it('round-trips the enveloped export format ({ type, version, templates })', () => {
    const existing = [makeTemplate({ id: 'a' })];
    const exported = JSON.stringify({
      type: 'wraith-split-templates',
      version: 1,
      templates: existing,
    });

    const result = resolveTemplateImport(existing, exported);

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.next).toHaveLength(1);
  });

  it('imports templates that do not exist locally yet', () => {
    const remote = JSON.stringify([makeTemplate({ id: 'remote-1', name: 'From teammate' })]);

    const result = resolveTemplateImport([], remote);

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.conflicts).toEqual([]);
    expect(result.next[0].name).toBe('From teammate');
  });

  it('reports a conflict when the same id exists locally with different content', () => {
    const local = [makeTemplate({ id: 'a', name: 'Payroll' })];
    const remote = JSON.stringify([makeTemplate({ id: 'a', name: 'Payroll (edited elsewhere)' })]);

    const result = resolveTemplateImport(local, remote);

    expect(result.imported).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toEqual({
      id: 'a',
      existingName: 'Payroll',
      incomingName: 'Payroll (edited elsewhere)',
    });
    // Existing template is left untouched until the caller resolves the conflict.
    expect(result.next[0].name).toBe('Payroll');
  });

  it('overwrites conflicting templates when overwriteConflicts is true', () => {
    const local = [makeTemplate({ id: 'a', name: 'Payroll' })];
    const remote = JSON.stringify([makeTemplate({ id: 'a', name: 'Payroll (edited elsewhere)' })]);

    const result = resolveTemplateImport(local, remote, true);

    expect(result.imported).toBe(1);
    expect(result.conflicts).toEqual([]);
    expect(result.next[0].name).toBe('Payroll (edited elsewhere)');
  });

  it('skips malformed entries instead of throwing', () => {
    const remote = JSON.stringify([{ not: 'a template' }, null, 42]);
    const result = resolveTemplateImport([], remote);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(3);
    expect(result.next).toEqual([]);
  });

  it('throws a clear error for invalid JSON', () => {
    expect(() => resolveTemplateImport([], 'not json')).toThrow(/valid JSON/i);
  });

  it('throws a clear error when the top level is neither an array nor an envelope', () => {
    expect(() => resolveTemplateImport([], '{}')).toThrow(/array/i);
  });
});