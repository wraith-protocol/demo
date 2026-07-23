import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseCsvRows, validateRow, validateRows, MAX_BATCH_ROWS } from './batchSend';
import type { BatchRow } from './batchSend';

// ---------------------------------------------------------------------------
// Mock @wraith-protocol/sdk so tests run without network or key material
// ---------------------------------------------------------------------------

vi.mock('@wraith-protocol/sdk/chains/stellar', () => ({
  decodeStealthMetaAddress: (addr: string) => {
    if (!addr.startsWith('st:xlm:')) throw new Error('bad meta-address');
    // Return fake key material — 32-byte arrays filled with a deterministic value
    const seed = addr.charCodeAt(7) % 256;
    return {
      spendingPubKey: new Uint8Array(32).fill(seed),
      viewingPubKey: new Uint8Array(32).fill((seed + 1) % 256),
    };
  },
  generateStealthAddress: (_spendPub: Uint8Array, _viewPub: Uint8Array) => ({
    stealthAddress: 'GSTEALTH123FAKEADDRESS',
    ephemeralPubKey: new Uint8Array(32),
    viewTag: 42,
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_META = 'st:xlm:AAAA_FAKE_META_ADDRESS';
const VALID_AMOUNT = '10';

function makeRow(overrides: Partial<BatchRow> = {}): BatchRow {
  return {
    index: 1,
    metaAddress: VALID_META,
    amountRaw: VALID_AMOUNT,
    memo: '',
    error: '',
    status: 'idle',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseCsvRows
// ---------------------------------------------------------------------------

describe('parseCsvRows', () => {
  it('returns empty array for empty input', () => {
    expect(parseCsvRows('')).toHaveLength(0);
    expect(parseCsvRows('   ')).toHaveLength(0);
    expect(parseCsvRows('\n\n\n')).toHaveLength(0);
  });

  it('parses a single data row', () => {
    const rows = parseCsvRows('st:xlm:AAA,10');
    expect(rows).toHaveLength(1);
    expect(rows[0].metaAddress).toBe('st:xlm:AAA');
    expect(rows[0].amountRaw).toBe('10');
    expect(rows[0].memo).toBe('');
  });

  it('parses three columns (memo present)', () => {
    const rows = parseCsvRows('st:xlm:AAA,5.5,my-memo');
    expect(rows).toHaveLength(1);
    expect(rows[0].memo).toBe('my-memo');
  });

  it('skips blank lines', () => {
    const csv = `st:xlm:AAA,1\n\nst:xlm:BBB,2\n`;
    const rows = parseCsvRows(csv);
    expect(rows).toHaveLength(2);
  });

  it('skips comment lines starting with #', () => {
    const csv = `# header comment\nst:xlm:AAA,1\n# another comment\nst:xlm:BBB,2`;
    const rows = parseCsvRows(csv);
    expect(rows).toHaveLength(2);
  });

  it('skips header row (meta_address,amount)', () => {
    const csv = `meta_address,amount\nst:xlm:AAA,1`;
    const rows = parseCsvRows(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].metaAddress).toBe('st:xlm:AAA');
  });

  it('skips header row case-insensitively (META_ADDRESS)', () => {
    const csv = `META_ADDRESS,AMOUNT\nst:xlm:AAA,1`;
    const rows = parseCsvRows(csv);
    expect(rows).toHaveLength(1);
  });

  it('skips header row with "recipient" keyword', () => {
    const csv = `recipient,amount,memo\nst:xlm:AAA,1,test`;
    const rows = parseCsvRows(csv);
    expect(rows).toHaveLength(1);
  });

  it('assigns sequential 1-based indexes', () => {
    const csv = `st:xlm:AAA,1\nst:xlm:BBB,2\nst:xlm:CCC,3`;
    const rows = parseCsvRows(csv);
    expect(rows.map((r) => r.index)).toEqual([1, 2, 3]);
  });

  it('handles CRLF line endings', () => {
    const csv = `st:xlm:AAA,1\r\nst:xlm:BBB,2\r\n`;
    const rows = parseCsvRows(csv);
    expect(rows).toHaveLength(2);
  });

  it('handles quoted fields with commas inside', () => {
    const csv = `"st:xlm:AAA,extra",10,memo`;
    const rows = parseCsvRows(csv);
    expect(rows).toHaveLength(1);
    // The quoted field becomes the meta-address including the inner comma
    expect(rows[0].metaAddress).toBe('st:xlm:AAA,extra');
  });

  it('handles double-quote escape inside quoted field', () => {
    const csv = `"st:xlm:AAA""B",5`;
    const rows = parseCsvRows(csv);
    expect(rows[0].metaAddress).toBe('st:xlm:AAA"B');
  });

  it('trims whitespace around fields', () => {
    const csv = `  st:xlm:AAA  ,  10  ,  memo  `;
    const rows = parseCsvRows(csv);
    expect(rows[0].metaAddress).toBe('st:xlm:AAA');
    expect(rows[0].amountRaw).toBe('10');
    expect(rows[0].memo).toBe('memo');
  });

  it('handles rows with only a meta-address (no amount)', () => {
    const csv = `st:xlm:AAA`;
    const rows = parseCsvRows(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].amountRaw).toBe('');
  });

  it('parses 20 rows correctly (benchmark size)', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `st:xlm:ADDR${i},${i + 1}`);
    const rows = parseCsvRows(lines.join('\n'));
    expect(rows).toHaveLength(20);
    expect(rows[0].amountRaw).toBe('1');
    expect(rows[19].amountRaw).toBe('20');
  });
});

// ---------------------------------------------------------------------------
// validateRow
// ---------------------------------------------------------------------------

describe('validateRow', () => {
  it('marks a fully valid row as valid', () => {
    const result = validateRow(makeRow(), 'XLM');
    expect(result.status).toBe('valid');
    expect(result.error).toBe('');
    expect(result.stealthAddress).toBe('GSTEALTH123FAKEADDRESS');
  });

  it('marks empty meta-address as invalid', () => {
    const result = validateRow(makeRow({ metaAddress: '' }), 'XLM');
    expect(result.status).toBe('invalid');
    expect(result.error).toMatch(/required/i);
  });

  it('rejects meta-address not starting with st:xlm:', () => {
    const result = validateRow(makeRow({ metaAddress: 'st:eth:0xABCD' }), 'XLM');
    expect(result.status).toBe('invalid');
    expect(result.error).toMatch(/st:xlm:/i);
  });

  it('rejects meta-address that fails SDK decode', () => {
    // Our mock throws when address doesn't start with st:xlm:
    const result = validateRow(makeRow({ metaAddress: 'garbage' }), 'XLM');
    expect(result.status).toBe('invalid');
  });

  it('marks empty amount as invalid', () => {
    const result = validateRow(makeRow({ amountRaw: '' }), 'XLM');
    expect(result.status).toBe('invalid');
    expect(result.error).toMatch(/required/i);
  });

  it('rejects non-numeric amount', () => {
    const result = validateRow(makeRow({ amountRaw: 'abc' }), 'XLM');
    expect(result.status).toBe('invalid');
    expect(result.error).toMatch(/invalid/i);
  });

  it('rejects zero amount', () => {
    const result = validateRow(makeRow({ amountRaw: '0' }), 'XLM');
    expect(result.status).toBe('invalid');
  });

  it('rejects negative amount', () => {
    const result = validateRow(makeRow({ amountRaw: '-1' }), 'XLM');
    expect(result.status).toBe('invalid');
  });

  it('rejects amount with too many decimals for XLM (>7)', () => {
    const result = validateRow(makeRow({ amountRaw: '1.12345678' }), 'XLM');
    expect(result.status).toBe('invalid');
    expect(result.error).toMatch(/decimal/i);
  });

  it('accepts amount with exactly 7 decimals for XLM', () => {
    const result = validateRow(makeRow({ amountRaw: '1.1234567' }), 'XLM');
    expect(result.status).toBe('valid');
  });

  it('accepts integer amount', () => {
    const result = validateRow(makeRow({ amountRaw: '100' }), 'XLM');
    expect(result.status).toBe('valid');
  });

  it('accepts minimum valid amount (0.0000001)', () => {
    const result = validateRow(makeRow({ amountRaw: '0.0000001' }), 'XLM');
    expect(result.status).toBe('valid');
  });

  it('rejects memo exceeding 28 bytes', () => {
    const longMemo = 'a'.repeat(29); // 29 ASCII chars = 29 bytes
    const result = validateRow(makeRow({ memo: longMemo }), 'XLM');
    expect(result.status).toBe('invalid');
    expect(result.error).toMatch(/memo/i);
  });

  it('accepts memo exactly 28 bytes', () => {
    const okMemo = 'a'.repeat(28);
    const result = validateRow(makeRow({ memo: okMemo }), 'XLM');
    expect(result.status).toBe('valid');
  });

  it('accepts empty memo', () => {
    const result = validateRow(makeRow({ memo: '' }), 'XLM');
    expect(result.status).toBe('valid');
  });
});

// ---------------------------------------------------------------------------
// validateRows
// ---------------------------------------------------------------------------

describe('validateRows', () => {
  it('returns empty array for empty input', () => {
    expect(validateRows([], 'XLM')).toHaveLength(0);
  });

  it('validates all rows', () => {
    const rows: BatchRow[] = [
      makeRow({ index: 1, amountRaw: '10' }),
      makeRow({ index: 2, amountRaw: '' }),
      makeRow({ index: 3, amountRaw: 'bad' }),
    ];
    const result = validateRows(rows, 'XLM');
    expect(result[0].status).toBe('valid');
    expect(result[1].status).toBe('invalid');
    expect(result[2].status).toBe('invalid');
  });

  it('marks rows beyond MAX_BATCH_ROWS as invalid', () => {
    const rows: BatchRow[] = Array.from({ length: MAX_BATCH_ROWS + 2 }, (_, i) =>
      makeRow({ index: i + 1 }),
    );
    const result = validateRows(rows, 'XLM');

    // Rows within limit should be valid
    expect(result[MAX_BATCH_ROWS - 1].status).toBe('valid');
    // Rows beyond limit should be invalid
    expect(result[MAX_BATCH_ROWS].status).toBe('invalid');
    expect(result[MAX_BATCH_ROWS + 1].status).toBe('invalid');
    expect(result[MAX_BATCH_ROWS].error).toMatch(/limit/i);
  });

  it('does not mutate original row objects', () => {
    const original: BatchRow[] = [makeRow({ status: 'idle' })];
    const result = validateRows(original, 'XLM');
    // Result is a new array of new objects
    expect(result).not.toBe(original);
    expect(result[0]).not.toBe(original[0]);
    // Original unchanged
    expect(original[0].status).toBe('idle');
  });

  it('all 20 valid rows pass validation (benchmark size)', () => {
    const rows: BatchRow[] = Array.from({ length: 20 }, (_, i) =>
      makeRow({ index: i + 1, amountRaw: String(i + 1) }),
    );
    const result = validateRows(rows, 'XLM');
    expect(result.every((r) => r.status === 'valid')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MAX_BATCH_ROWS constant
// ---------------------------------------------------------------------------

describe('MAX_BATCH_ROWS', () => {
  it('is 100', () => {
    expect(MAX_BATCH_ROWS).toBe(100);
  });
});
