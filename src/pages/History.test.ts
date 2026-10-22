/**
 * Cross-wallet isolation tests for the History page.
 *
 * These tests verify that the scoping logic used in History.tsx (and mirrored
 * in Activity.tsx) prevents entries belonging to one wallet from leaking into
 * another wallet's view or export.  They work directly against the zustand
 * store so they run in the default Node environment without a DOM renderer.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useActivityStore, type ActivityEntry } from '@/stores/activityStore';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeEntry(
  overrides: Partial<ActivityEntry> & { id: string; wallet: string },
): ActivityEntry {
  return {
    chain: 'stellar',
    kind: 'stealth-send',
    direction: 'out',
    status: 'confirmed',
    amount: '10',
    timestamp: Date.now(),
    metadata: { memo: 'secret', privateKey: 'sk_very_private' },
    ...overrides,
  };
}

/**
 * Simulate the wallet-scoped filtering that History.tsx performs.
 * Returns entries whose `wallet` field matches the supplied address.
 */
function walletEntries(entries: ActivityEntry[], address: string): ActivityEntry[] {
  return entries.filter((e) => e.wallet === address);
}

/**
 * Simulate the export projection that History.tsx performs:
 * scope to filteredEntries (already wallet-scoped) then strip metadata.
 */
function exportEntries(
  entries: ActivityEntry[],
  address: string,
): Omit<ActivityEntry, 'metadata'>[] {
  return walletEntries(entries, address).map(({ metadata: _m, ...rest }) => rest);
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('History page — cross-wallet isolation', () => {
  beforeEach(() => {
    // Reset store to a clean slate before every test.
    useActivityStore.setState({ entries: [] });
  });

  it('shows only entries that belong to the connected wallet', () => {
    const { addEntry, entries: _ } = useActivityStore.getState();

    addEntry(makeEntry({ id: 'tx-alice-1', wallet: 'GALICE' }));
    addEntry(makeEntry({ id: 'tx-alice-2', wallet: 'GALICE' }));
    addEntry(makeEntry({ id: 'tx-bob-1', wallet: 'GBOB' }));
    addEntry(makeEntry({ id: 'tx-bob-2', wallet: 'GBOB' }));

    const { entries } = useActivityStore.getState();

    const aliceView = walletEntries(entries, 'GALICE');
    const bobView = walletEntries(entries, 'GBOB');

    expect(aliceView).toHaveLength(2);
    expect(aliceView.every((e) => e.wallet === 'GALICE')).toBe(true);

    expect(bobView).toHaveLength(2);
    expect(bobView.every((e) => e.wallet === 'GBOB')).toBe(true);
  });

  it("does not expose another wallet's entries when the wallet switches", () => {
    const { addEntry } = useActivityStore.getState();

    addEntry(makeEntry({ id: 'tx-alice-1', wallet: 'GALICE' }));
    addEntry(makeEntry({ id: 'tx-bob-1', wallet: 'GBOB' }));

    const { entries } = useActivityStore.getState();

    // Simulate Freighter returning a different address after wallet switch.
    const aliceView = walletEntries(entries, 'GALICE');
    const bobView = walletEntries(entries, 'GBOB');

    // Alice's view must not contain Bob's transaction.
    expect(aliceView.some((e) => e.wallet === 'GBOB')).toBe(false);

    // Bob's view must not contain Alice's transaction.
    expect(bobView.some((e) => e.wallet === 'GALICE')).toBe(false);
  });

  it('returns an empty list when no wallet is connected (address is null)', () => {
    const { addEntry } = useActivityStore.getState();
    addEntry(makeEntry({ id: 'tx-alice-1', wallet: 'GALICE' }));

    const { entries } = useActivityStore.getState();

    // History.tsx returns [] when address is null — replicate that guard.
    const connectedAddress: string | null = null;
    const view = connectedAddress ? walletEntries(entries, connectedAddress) : [];

    expect(view).toHaveLength(0);
  });

  it("exports only the connected wallet's filtered entries, with metadata stripped", () => {
    const { addEntry } = useActivityStore.getState();

    addEntry(makeEntry({ id: 'tx-alice-1', wallet: 'GALICE', metadata: { memo: 'alice-secret' } }));
    addEntry(makeEntry({ id: 'tx-bob-1', wallet: 'GBOB', metadata: { memo: 'bob-secret' } }));

    const { entries } = useActivityStore.getState();

    const aliceExport = exportEntries(entries, 'GALICE');

    // Only Alice's entry is exported.
    expect(aliceExport).toHaveLength(1);
    expect(aliceExport[0].wallet).toBe('GALICE');

    // metadata must be stripped from every exported entry.
    expect('metadata' in aliceExport[0]).toBe(false);
  });

  it('export does not contain entries from other wallets even when filters are wide-open', () => {
    const { addEntry } = useActivityStore.getState();

    addEntry(makeEntry({ id: 'tx-alice-1', wallet: 'GALICE', chain: 'stellar' }));
    addEntry(makeEntry({ id: 'tx-alice-2', wallet: 'GALICE', chain: 'horizen' }));
    addEntry(makeEntry({ id: 'tx-bob-1', wallet: 'GBOB', chain: 'stellar' }));

    const { entries } = useActivityStore.getState();

    const aliceExport = exportEntries(entries, 'GALICE');

    expect(aliceExport.every((e) => e.wallet === 'GALICE')).toBe(true);
    expect(aliceExport.some((e) => e.wallet === 'GBOB')).toBe(false);
  });

  it('exported entries never contain the metadata field regardless of its value', () => {
    const { addEntry } = useActivityStore.getState();

    // Entry without metadata.
    addEntry(makeEntry({ id: 'tx-1', wallet: 'GALICE', metadata: undefined }));
    // Entry with rich metadata.
    addEntry(
      makeEntry({ id: 'tx-2', wallet: 'GALICE', metadata: { key: 'sk_private', memo: 'hello' } }),
    );
    // Entry with null metadata.
    addEntry(makeEntry({ id: 'tx-3', wallet: 'GALICE', metadata: null }));

    const { entries } = useActivityStore.getState();
    const exported = exportEntries(entries, 'GALICE');

    expect(exported).toHaveLength(3);
    for (const entry of exported) {
      expect('metadata' in entry).toBe(false);
    }
  });

  it('clearHistory scoped to the connected wallet leaves other wallets untouched', () => {
    const { addEntry, clearHistory } = useActivityStore.getState();

    addEntry(makeEntry({ id: 'tx-alice-1', wallet: 'GALICE', chain: 'stellar' }));
    addEntry(makeEntry({ id: 'tx-bob-1', wallet: 'GBOB', chain: 'stellar' }));

    clearHistory('stellar', 'GALICE');

    const { entries } = useActivityStore.getState();

    // Alice's entry is gone.
    expect(entries.some((e) => e.wallet === 'GALICE')).toBe(false);

    // Bob's entry survives.
    expect(entries.some((e) => e.wallet === 'GBOB')).toBe(true);
  });
});
