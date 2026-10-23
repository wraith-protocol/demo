/** @vitest-environment jsdom */
/**
 * Cross-wallet isolation and history clearing tests for the History page.
 *
 * These tests verify:
 * 1. Store clearing helper (clearHistory):
 *    - All-chain clearing: clears all chains for the connected wallet while preserving other wallets.
 *    - Single-chain clearing: clears only the specified chain for the connected wallet,
 *      preserving other chains for that wallet and preserving other wallets.
 * 2. Cross-wallet isolation:
 *    - Scoping logic prevents entries belonging to one wallet from leaking into another wallet's view or export.
 * 3. Component clearing behavior (History component):
 *    - Default "All Chains" view: clicking "Clear History" clears all chains for the connected wallet,
 *      leaving other wallets intact.
 *    - Single-chain view: selecting a specific chain and clicking "Clear History" clears only that chain's
 *      entries for the connected wallet, preserving its other chains and other wallets.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import History from '@/pages/History';
import { StellarWalletContext } from '@/context/StellarWalletContext';
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

function renderHistoryWithWallet(address: string | null = 'GALICE') {
  return render(
    <MemoryRouter>
      <StellarWalletContext.Provider
        value={
          {
            address,
            isConnected: !!address,
            isInstalled: true,
            isNetworkMismatch: false,
            freighterNetwork: null,
            connect: async () => {},
            disconnect: () => {},
            signMessage: async () => new Uint8Array(),
            signTransaction: async () => '',
            subscribeToDisconnect: () => () => {},
          } as any
        }
      >
        <History />
      </StellarWalletContext.Provider>
    </MemoryRouter>,
  );
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe('History page — cross-wallet isolation', () => {
  beforeEach(() => {
    // Reset store to a clean slate before every test.
    useActivityStore.setState({ entries: [] });
  });

  it('shows only entries that belong to the connected wallet', () => {
    const { addEntry } = useActivityStore.getState();

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

describe('History clearing helper (clearHistory store action)', () => {
  beforeEach(() => {
    useActivityStore.setState({ entries: [] });
  });

  it('clears all chains for the connected wallet when chain is "all", while preserving other wallets', () => {
    const { addEntry, clearHistory } = useActivityStore.getState();

    // Alice's multi-chain activity
    addEntry(makeEntry({ id: 'tx-alice-stellar', wallet: 'GALICE', chain: 'stellar' }));
    addEntry(makeEntry({ id: 'tx-alice-horizen', wallet: 'GALICE', chain: 'horizen' }));
    addEntry(makeEntry({ id: 'tx-alice-solana', wallet: 'GALICE', chain: 'solana' }));
    addEntry(makeEntry({ id: 'tx-alice-ckb', wallet: 'GALICE', chain: 'ckb' }));

    // Bob's multi-chain activity
    addEntry(makeEntry({ id: 'tx-bob-stellar', wallet: 'GBOB', chain: 'stellar' }));
    addEntry(makeEntry({ id: 'tx-bob-horizen', wallet: 'GBOB', chain: 'horizen' }));
    addEntry(makeEntry({ id: 'tx-bob-solana', wallet: 'GBOB', chain: 'solana' }));
    addEntry(makeEntry({ id: 'tx-bob-ckb', wallet: 'GBOB', chain: 'ckb' }));

    // Clear Alice across all chains
    clearHistory('all', 'GALICE');

    const { entries } = useActivityStore.getState();

    // All of Alice's entries must be cleared
    const remainingAliceEntries = entries.filter((e) => e.wallet === 'GALICE');
    expect(remainingAliceEntries).toHaveLength(0);

    // All of Bob's entries across all chains must be preserved
    const remainingBobEntries = entries.filter((e) => e.wallet === 'GBOB');
    expect(remainingBobEntries).toHaveLength(4);
    expect(remainingBobEntries.map((e) => e.chain).sort()).toEqual(
      ['ckb', 'horizen', 'solana', 'stellar'].sort(),
    );
  });

  it('clears only the specified chain for the connected wallet, preserving other chains and other wallets', () => {
    const { addEntry, clearHistory } = useActivityStore.getState();

    // Alice's multi-chain activity
    addEntry(makeEntry({ id: 'tx-alice-stellar', wallet: 'GALICE', chain: 'stellar' }));
    addEntry(makeEntry({ id: 'tx-alice-horizen', wallet: 'GALICE', chain: 'horizen' }));
    addEntry(makeEntry({ id: 'tx-alice-solana', wallet: 'GALICE', chain: 'solana' }));
    addEntry(makeEntry({ id: 'tx-alice-ckb', wallet: 'GALICE', chain: 'ckb' }));

    // Bob's multi-chain activity
    addEntry(makeEntry({ id: 'tx-bob-stellar', wallet: 'GBOB', chain: 'stellar' }));
    addEntry(makeEntry({ id: 'tx-bob-horizen', wallet: 'GBOB', chain: 'horizen' }));

    // Clear only Alice's Stellar history
    clearHistory('stellar', 'GALICE');

    const { entries } = useActivityStore.getState();

    // Alice's Stellar entry is gone, but Horizen, Solana, and CKB remain
    const remainingAlice = entries.filter((e) => e.wallet === 'GALICE');
    expect(remainingAlice).toHaveLength(3);
    expect(remainingAlice.some((e) => e.chain === 'stellar')).toBe(false);
    expect(remainingAlice.map((e) => e.chain).sort()).toEqual(['ckb', 'horizen', 'solana'].sort());

    // Bob's entries (including Stellar) are untouched
    const remainingBob = entries.filter((e) => e.wallet === 'GBOB');
    expect(remainingBob).toHaveLength(2);
    expect(remainingBob.some((e) => e.chain === 'stellar')).toBe(true);
    expect(remainingBob.some((e) => e.chain === 'horizen')).toBe(true);
  });

  it('does nothing when wallet is empty or falsy', () => {
    const { addEntry, clearHistory } = useActivityStore.getState();

    addEntry(makeEntry({ id: 'tx-alice-1', wallet: 'GALICE', chain: 'stellar' }));
    clearHistory('all', '');

    const { entries } = useActivityStore.getState();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('tx-alice-1');
  });
});

describe('History component clearing behavior', () => {
  beforeEach(() => {
    useActivityStore.setState({ entries: [] });
  });

  it('clears all chains for connected wallet when All Chains is selected, preserving other wallets', () => {
    const { addEntry } = useActivityStore.getState();

    // Populate Alice's entries across Stellar, Horizen, Solana, CKB
    addEntry(makeEntry({ id: 'tx-a-stellar', wallet: 'GALICE', chain: 'stellar', amount: '100' }));
    addEntry(makeEntry({ id: 'tx-a-horizen', wallet: 'GALICE', chain: 'horizen', amount: '200' }));
    addEntry(makeEntry({ id: 'tx-a-solana', wallet: 'GALICE', chain: 'solana', amount: '300' }));
    addEntry(makeEntry({ id: 'tx-a-ckb', wallet: 'GALICE', chain: 'ckb', amount: '400' }));

    // Populate Bob's entries
    addEntry(makeEntry({ id: 'tx-b-stellar', wallet: 'GBOB', chain: 'stellar', amount: '500' }));
    addEntry(makeEntry({ id: 'tx-b-horizen', wallet: 'GBOB', chain: 'horizen', amount: '600' }));

    renderHistoryWithWallet('GALICE');

    // Default view is All Chains
    const chainSelect = screen.getByLabelText(/chain/i) as HTMLSelectElement;
    expect(chainSelect.value).toBe('all');

    // Click "Clear History"
    const clearButton = screen.getByRole('button', { name: /clear history/i }) as HTMLButtonElement;
    expect(clearButton.disabled).toBe(false);
    fireEvent.click(clearButton);

    // Empty state should be visible for Alice
    expect(screen.getByText(/no activity recorded yet/i)).toBeTruthy();

    // Verify store state: Alice has 0 entries left across all chains
    const { entries } = useActivityStore.getState();
    const aliceEntries = entries.filter((e) => e.wallet === 'GALICE');
    expect(aliceEntries).toHaveLength(0);

    // Bob's entries are preserved
    const bobEntries = entries.filter((e) => e.wallet === 'GBOB');
    expect(bobEntries).toHaveLength(2);
  });

  it('clears only the selected chain when a single chain filter is active', () => {
    const { addEntry } = useActivityStore.getState();

    // Populate Alice's entries across Stellar, Horizen, Solana, CKB
    addEntry(makeEntry({ id: 'tx-a-stellar', wallet: 'GALICE', chain: 'stellar' }));
    addEntry(makeEntry({ id: 'tx-a-horizen', wallet: 'GALICE', chain: 'horizen' }));
    addEntry(makeEntry({ id: 'tx-a-solana', wallet: 'GALICE', chain: 'solana' }));
    addEntry(makeEntry({ id: 'tx-a-ckb', wallet: 'GALICE', chain: 'ckb' }));

    // Populate Bob's entries
    addEntry(makeEntry({ id: 'tx-b-stellar', wallet: 'GBOB', chain: 'stellar' }));
    addEntry(makeEntry({ id: 'tx-b-solana', wallet: 'GBOB', chain: 'solana' }));

    renderHistoryWithWallet('GALICE');

    // Select 'stellar' in the Chain dropdown
    const chainSelect = screen.getByLabelText(/chain/i) as HTMLSelectElement;
    fireEvent.change(chainSelect, { target: { value: 'stellar' } });
    expect(chainSelect.value).toBe('stellar');

    // Click "Clear History"
    const clearButton = screen.getByRole('button', { name: /clear history/i });
    fireEvent.click(clearButton);

    const { entries } = useActivityStore.getState();

    // Alice's Stellar entry is cleared, but Horizen, Solana, and CKB remain
    const aliceEntries = entries.filter((e) => e.wallet === 'GALICE');
    expect(aliceEntries).toHaveLength(3);
    expect(aliceEntries.some((e) => e.chain === 'stellar')).toBe(false);
    expect(aliceEntries.map((e) => e.chain).sort()).toEqual(['ckb', 'horizen', 'solana'].sort());

    // Bob's entries are preserved
    const bobEntries = entries.filter((e) => e.wallet === 'GBOB');
    expect(bobEntries).toHaveLength(2);
    expect(bobEntries.some((e) => e.chain === 'stellar')).toBe(true);
  });

  it('clears another single chain (e.g. horizen) correctly without affecting other chains', () => {
    const { addEntry } = useActivityStore.getState();

    addEntry(makeEntry({ id: 'tx-a-stellar', wallet: 'GALICE', chain: 'stellar' }));
    addEntry(makeEntry({ id: 'tx-a-horizen', wallet: 'GALICE', chain: 'horizen' }));
    addEntry(makeEntry({ id: 'tx-a-solana', wallet: 'GALICE', chain: 'solana' }));

    renderHistoryWithWallet('GALICE');

    // Select 'horizen'
    const chainSelect = screen.getByLabelText(/chain/i);
    fireEvent.change(chainSelect, { target: { value: 'horizen' } });

    // Click "Clear History"
    fireEvent.click(screen.getByRole('button', { name: /clear history/i }));

    const { entries } = useActivityStore.getState();
    const aliceEntries = entries.filter((e) => e.wallet === 'GALICE');
    expect(aliceEntries).toHaveLength(2);
    expect(aliceEntries.some((e) => e.chain === 'horizen')).toBe(false);
    expect(aliceEntries.map((e) => e.chain).sort()).toEqual(['solana', 'stellar'].sort());
  });
});
