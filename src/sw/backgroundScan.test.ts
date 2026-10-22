import { describe, expect, it, vi } from 'vitest';
import {
  bytesToHex,
  deriveStealthKeys,
  generateStealthAddress,
  SCHEME_ID,
} from '@wraith-protocol/sdk/chains/stellar';
import type { Announcement } from '@wraith-protocol/sdk/chains/stellar';
import {
  buildMatchNotification,
  scanPages,
  type BackgroundMatch,
  type ScanPage,
} from './backgroundScan';
import {
  lockAllScanKeys,
  lockScanKey,
  removeScanKey,
  sealScanKey,
  toScanKeyMaterial,
  type ScanKeyBackend,
} from './scanKeyStore';
import { MemoryScanKeyBackend } from './testing/memoryScanKeyBackend';

const ACCOUNT = 'GTESTACCOUNT';

function randomSignature(): Uint8Array {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return bytes;
}

function makeAnnouncement(spendingPubKey: Uint8Array, viewingPubKey: Uint8Array): Announcement {
  const generated = generateStealthAddress(spendingPubKey, viewingPubKey);
  return {
    schemeId: SCHEME_ID,
    stealthAddress: generated.stealthAddress,
    caller: 'GARBAGECALLERADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    ephemeralPubKey: bytesToHex(generated.ephemeralPubKey),
    metadata: bytesToHex(new Uint8Array([generated.viewTag])),
  };
}

function setup() {
  const recipient = deriveStealthKeys(randomSignature());
  const stranger = deriveStealthKeys(randomSignature());
  const mine = makeAnnouncement(recipient.spendingPubKey, recipient.viewingPubKey);
  const mine2 = makeAnnouncement(recipient.spendingPubKey, recipient.viewingPubKey);
  const noise = makeAnnouncement(stranger.spendingPubKey, stranger.viewingPubKey);
  const notified: BackgroundMatch[] = [];
  const commits: number[] = [];
  const pages: ScanPage[] = [
    { announcements: [noise, mine], committedLedger: 100 },
    { announcements: [mine2], committedLedger: 200 },
  ];
  const readPages = vi.fn(async (onPage: (page: ScanPage) => Promise<void>) => {
    for (const page of pages) await onPage(page);
  });
  const run = (
    backend: ScanKeyBackend,
    opts: { publicKey?: string; onCommit?: () => Promise<void> } = {},
  ) =>
    scanPages({
      backend,
      publicKey: opts.publicKey ?? ACCOUNT,
      notifyMatch: async (m) => {
        notified.push(m);
      },
      readPages,
      commit: async (next) => {
        commits.push(next);
        await opts.onCommit?.();
      },
    });
  const registered = async () => {
    const backend = new MemoryScanKeyBackend();
    await sealScanKey(backend, ACCOUNT, toScanKeyMaterial(recipient));
    return backend;
  };
  const addresses = () => notified.map((m) => m.stealthAddress);
  return { recipient, mine, mine2, notified, commits, readPages, run, registered, addresses };
}

describe('background page scanning', () => {
  it('notifies matches page by page, commits each page after it, and leaks no secrets', async () => {
    const { recipient, mine, mine2, commits, notified, run, registered, addresses } = setup();
    const backend = await registered();

    expect(await run(backend)).toEqual({ status: 'scanned' });

    expect(addresses()).toEqual([mine.stealthAddress, mine2.stealthAddress]);
    expect(commits).toEqual([101, 201]);

    const wire = JSON.stringify([notified, commits, buildMatchNotification(notified[0])]);
    expect(wire).not.toContain(recipient.spendingScalar.toString(16));
    expect(wire).not.toContain(recipient.spendingScalar.toString());
    expect(wire).not.toContain(bytesToHex(recipient.viewingKey));
    expect(backend.dump()).not.toContain(recipient.spendingScalar.toString());
  });

  it('lock: reads nothing, commits nothing and notifies nothing; unlocking resumes', async () => {
    const { recipient, notified, commits, readPages, run, registered } = setup();
    const backend = await registered();

    await lockScanKey(backend, ACCOUNT);
    expect(await run(backend)).toEqual({ status: 'locked' });
    expect(readPages).not.toHaveBeenCalled();
    expect(commits).toEqual([]);
    expect(notified).toHaveLength(0);

    await sealScanKey(backend, ACCOUNT, toScanKeyMaterial(recipient)); // unlock
    expect((await run(backend)).status).toBe('scanned');
    expect(commits).toEqual([101, 201]);
  });

  it('lock-all locks every account', async () => {
    const { run, registered } = setup();
    const backend = await registered();
    await lockAllScanKeys(backend);
    expect((await run(backend)).status).toBe('locked');
  });

  it('a lock between pages stops the scan without committing the unread page', async () => {
    const { commits, run, registered, addresses, mine } = setup();
    const backend = await registered();

    const result = await run(backend, { onCommit: () => lockScanKey(backend, ACCOUNT) });

    expect(result).toEqual({ status: 'locked' });
    expect(addresses()).toEqual([mine.stealthAddress]); // page 2 was never matched
    expect(commits).toEqual([101]); // the cursor stops before page 2, so it is re-read later
  });

  it('restart: a fresh worker resumes from persisted state alone', async () => {
    const { run, registered, commits } = setup();
    const backend = await registered();

    expect((await run(backend.restart())).status).toBe('scanned');
    expect(commits).toEqual([101, 201]);
  });

  it('restart: a locked key stays locked', async () => {
    const { run, registered } = setup();
    const backend = await registered();
    await lockScanKey(backend, ACCOUNT);

    expect((await run(backend.restart())).status).toBe('locked');
  });

  it('key removal wipes everything and the worker goes idle', async () => {
    const { readPages, notified, commits, run, registered } = setup();
    const backend = await registered();

    await removeScanKey(backend, ACCOUNT);

    expect(backend.records.size).toBe(0);
    expect(backend.keys.size).toBe(0);
    expect(await run(backend.restart())).toEqual({ status: 'missing' });
    expect(readPages).not.toHaveBeenCalled();
    expect(notified).toHaveLength(0);
    expect(commits).toEqual([]);
  });

  it('a sealed blob cannot be reused for another account', async () => {
    const { run, registered } = setup();
    const backend = await registered();
    backend.records.set('GOTHER', { ...backend.records.get(ACCOUNT)!, publicKey: 'GOTHER' });
    backend.keys.set('GOTHER', backend.keys.get(ACCOUNT)!);

    expect((await run(backend, { publicKey: 'GOTHER' })).status).toBe('invalid');
  });
});
