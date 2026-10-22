import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKER_FACING_FILES = [
  'src/sw/app-sw.ts',
  'src/hooks/useStellarNotifications.ts',
  'src/sw/backgroundScan.ts',
  'src/sw/scanKeyStore.ts',
  'src/sw/idbScanKeyBackend.ts',
  'src/workers/stellarScanMatch.ts',
];

describe('spending secrets stay out of worker-facing code', () => {
  it.each(WORKER_FACING_FILES)('%s never mentions a spending scalar', (file) => {
    const source = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    expect(source).not.toMatch(/spendingScalar/i);
  });
});
