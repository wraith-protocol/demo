import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseCsvRows,
  serializeRowsToCsv,
  validateRow,
  validateRows,
  MAX_BATCH_ROWS,
} from './batchSend';
import type { BatchRow } from './batchSend';

// ---------------------------------------------------------------------------
// Mock @wraith-protocol/sdk so tests run without network or key material
// ---------------------------------------------------------------------------

vi.mock('@wraith-protocol/sdk/chains/stellar', () => ({
  decodeStealthMetaAddress: (addr: string) => {
    if (!addr.startsWith('st:xlm:')) throw new Error('bad meta-address');
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
// serializeRowsToCsv
// ---------------------------------------------------------------------------

describe('serializeRowsToCsv', () => {
  it('returns empty string for empty input', () => {
    expect(serializeRowsToCsv([])).toBe('');
  });

  it('serializes a two-column row when memo is empty', () => {
    const csv = serializeRowsToCsv([{ metaAddress: 'st:xlm:AAA', amountRaw: '10', memo: '' }]);
    expect(csv).toBe('st:xlm:AAA,10');
  });

  it('serializes a three-column row when memo is present', () => {
    const csv = serializeRowsToCsv([
      { metaAddress: 'st:xlm:AAA', amountRaw: '5.5', memo: 'payment-1' },
    ]);
    expect(csv).toBe('st:xlm:AAA,5.5,payment-1');
  });

  it('joins multiple rows with newlines', () => {
    const csv = serializeRowsToCsv([
      { metaAddress: 'st:xlm:AAA', amountRaw: '10', memo: '' },
      { metaAddress: 'st:xlm:BBB', amountRaw: '5.5', memo: 'payment-1' },
    ]);
    expect(csv).toBe('st:xlm:AAA,10\nst:xlm:BBB,5.5,payment-1');
  });

  it('quotes fields containing commas', () => {
    const csv = serializeRowsToCsv([
      { metaAddress: 'st:xlm:AAA,extra', amountRaw: '10', memo: '' },
    ]);
    expect(csv).toBe('"st:xlm:AAA,extra",10');
  });

  it('escapes embedded double quotes', () => {
    const csv = serializeRowsToCsv([{ metaAddress: 'st:xlm:AAA"B', amountRaw: '5', memo: '' }]);
    expect(csv).toBe('"st:xlm:AAA""B",5');
  });

  it('round-trips through parseCsvRows', () => {
    const original = [
      { metaAddress: 'st:xlm:AAA', amountRaw: '10', memo: '' },
      { metaAddress: 'st:xlm:BBB', amountRaw: '5.5', memo: 'payment-1' },
    ];
    const parsed = parseCsvRows(serializeRowsToCsv(original));
    expect(parsed.map((r) => r.metaAddress)).toEqual(original.map((r) => r.metaAddress));
    expect(parsed.map((r) => r.amountRaw)).toEqual(original.map((r) => r.amountRaw));
    expect(parsed.map((r) => r.memo)).toEqual(original.map((r) => r.memo));
  });
});
