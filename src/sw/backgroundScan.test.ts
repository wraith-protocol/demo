import { describe, expect, it, vi } from 'vitest';
import {
  bytesToHex,
  deriveStealthKeys,
  generateStealthAddress,
  SCHEME_ID,
} from '@wraith-protocol/sdk/chains/stellar';
import type { Announcement } from '@wraith-protocol/sdk/chains/stellar';
import { buildMatchNotification, scanWithStoredKey, type BackgroundMatch } from './backgroundScan';
import {
  lockAllScanKeys,
  lockScanKey,
  removeScanKey,
  sealScanKey,
  toScanKeyMaterial,
} from './scanKeyStore';
import type { ScanKeyBackend } from './scanKeyStore';
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
  const noise = makeAnnouncement(stranger.spendingPubKey, stranger.viewingPubKey);
  const notified: BackgroundMatch[] = [];
  const loadAnnouncements = vi.fn(async () => ({
    announcements: [noise, mine],
    latestLedger: 100,
  }));
  const scan = (backend: ScanKeyBackend, publicKey = ACCOUNT) =>
    scanWithStoredKey({
      backend,
      publicKey,
      loadAnnouncements,
      notifyMatch: async (m) => {
        notified.push(m);
      },
    });
  const registered = async () => {
    const backend = new MemoryScanKeyBackend();
    await sealScanKey(backend, ACCOUNT, toScanKeyMaterial(recipient));
    return backend;
  };
  return { recipient, mine, notified, loadAnnouncements, scan, registered };
}

describe('background scanning', () => {
  it('notifies only for matching announcements and leaks no secrets', async () => {
    const { recipient, mine, notified, scan, registered } = setup();
    const backend = await registered();

    const result = await scan(backend);

    expect(result).toMatchObject({ status: 'scanned', nextLedger: 101 });
    expect(notified).toEqual([{ publicKey: ACCOUNT, stealthAddress: mine.stealthAddress }]);

    const wire = JSON.stringify([result, notified, buildMatchNotification(notified[0])]);
    expect(wire).not.toContain(recipient.spendingScalar.toString(16));
    expect(wire).not.toContain(recipient.spendingScalar.toString());
    expect(wire).not.toContain(bytesToHex(recipient.viewingKey));
    expect(backend.dump()).not.toContain(recipient.spendingScalar.toString());
  });

  it('lock: does not decrypt, fetch or notify; unlocking resumes scanning', async () => {
    const { recipient, notified, loadAnnouncements, scan, registered } = await (async () => {
      const s = setup();
      return { ...s, registered: s.registered };
    })();
    const backend = await registered();

    await lockScanKey(backend, ACCOUNT);
    expect(await scan(backend)).toEqual({ status: 'locked' });
    expect(loadAnnouncements).not.toHaveBeenCalled();
    expect(notified).toHaveLength(0);

    await sealScanKey(backend, ACCOUNT, toScanKeyMaterial(recipient)); // unlock
    expect((await scan(backend)).status).toBe('scanned');
    expect(notified).toHaveLength(1);
  });

  it('lock-all locks every account', async () => {
    const { scan, registered } = setup();
    const backend = await registered();
    await lockAllScanKeys(backend);
    expect((await scan(backend)).status).toBe('locked');
  });

  it('lock during a scan suppresses the notification', async () => {
    const { mine, notified, loadAnnouncements, scan, registered } = setup();
    const backend = await registered();
    loadAnnouncements.mockImplementationOnce(async () => {
      await lockScanKey(backend, ACCOUNT);
      return { announcements: [mine], latestLedger: 100 };
    });

    expect(await scan(backend)).toEqual({ status: 'locked' });
    expect(notified).toHaveLength(0);
  });

  it('restart: a fresh worker resumes from persisted state alone', async () => {
    const { notified, scan, registered } = setup();
    const backend = await registered();

    const afterRestart = backend.restart();
    expect((await scan(afterRestart)).status).toBe('scanned');
    expect(notified).toHaveLength(1);
  });

  it('restart: a locked key stays locked', async () => {
    const { scan, registered } = setup();
    const backend = await registered();
    await lockScanKey(backend, ACCOUNT);

    expect((await scan(backend.restart())).status).toBe('locked');
  });

  it('key removal wipes everything and the worker goes idle', async () => {
    const { notified, loadAnnouncements, scan, registered } = setup();
    const backend = await registered();

    await removeScanKey(backend, ACCOUNT);

    expect(backend.records.size).toBe(0);
    expect(backend.keys.size).toBe(0);
    expect(await scan(backend.restart())).toEqual({ status: 'missing' });
    expect(loadAnnouncements).not.toHaveBeenCalled();
    expect(notified).toHaveLength(0);
  });

  it('a sealed blob cannot be reused for another account', async () => {
    const { scan, registered } = setup();
    const backend = await registered();
    backend.records.set('GOTHER', { ...backend.records.get(ACCOUNT)!, publicKey: 'GOTHER' });
    backend.keys.set('GOTHER', backend.keys.get(ACCOUNT)!);

    expect((await scan(backend, 'GOTHER')).status).toBe('invalid');
  });
});
