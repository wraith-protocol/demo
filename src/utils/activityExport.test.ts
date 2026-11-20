import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import type { ActivityEntry } from '@/stores/activityStore';
import { activityToCsv, activityToJson, sanitizeCsvMemo } from '@/utils/activityExport';

const baseEntry: ActivityEntry = {
  id: 'abc123',
  chain: 'stellar',
  wallet: 'GWALLET',
  kind: 'stealth-send',
  direction: 'out',
  status: 'confirmed',
  amount: '25.50',
  recipient: 'GRECIPIENT',
  timestamp: Date.UTC(2026, 6, 26, 12, 30),
};

describe('activity CSV export', () => {
  it.each(['=1+1', '+SUM(A1:A2)', '-2+3', '@SUM(A1:A2)'])(
    'neutralizes formula-like memo %s',
    (memo) => {
      expect(sanitizeCsvMemo(memo)).toBe(`'${memo}`);

      const csv = activityToCsv([{ ...baseEntry, metadata: { memo } }]);
      expect(csv.split('\r\n')[1]).toContain(`,'${memo}`);
    },
  );

  it('escapes commas, quotes, and newlines using RFC 4180 quoting', () => {
    const csv = activityToCsv([{ ...baseEntry, metadata: { memo: 'invoice "July", phase\n2' } }]);

    expect(csv).toContain('"invoice ""July"", phase\n2"');
  });
});

describe('activity JSON export', () => {
  it('validates against the shipped activity schema', () => {
    const schema = JSON.parse(
      readFileSync(new URL('../schema/activity.json', import.meta.url), 'utf8'),
    );
    const validate = new Ajv2020({ strict: true }).compile(schema);
    const exported = JSON.parse(
      activityToJson([{ ...baseEntry, metadata: { memo: 'Invoice 42' } }]),
    );

    expect(validate(exported), validate.errors?.map((error) => error.message).join(', ')).toBe(
      true,
    );
  });
});
