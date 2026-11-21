/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_DATA_STORAGE_KEYS } from './localData';
import { AUCTION_STORAGE_KEY } from './auctionEncryption';
import { OFFLINE_QUEUE_STORAGE_KEY } from './offlineQueue';
import { scanCursorKey } from './stellar/scannerCursor';
import { recipientVaultStorageKey } from './stellar/vaultClaim';
import { loadPersistedVaultDeposits } from './stellar/vaultDeposit';
import { reserveSubmissionOperationId } from './submissionIdempotency';
import { useActivityStore } from '@/stores/activityStore';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useScheduleStore } from '@/stores/scheduleStore';
import { VAULT_STORAGE_KEY } from '@/store/nameWatchlistStore';

const WALLET = `G${'A'.repeat(55)}`;

// The inventory names every store's key itself, so a renamed key in a store
// would silently drop that store from export and deletion. These checks pin
// the registry to the modules that own the keys.
describe('local data storage registry', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('matches the zustand persist keys', () => {
    expect(useActivityStore.persist.getOptions().name).toBe(LOCAL_DATA_STORAGE_KEYS.activity);
    expect(useScheduleStore.persist.getOptions().name).toBe(LOCAL_DATA_STORAGE_KEYS.schedules);
    expect(useNotificationsStore.persist.getOptions().name).toBe(
      LOCAL_DATA_STORAGE_KEYS.notifications,
    );
  });

  it('matches the queue, cursor, auction and vault keys', () => {
    expect(LOCAL_DATA_STORAGE_KEYS.offlineQueue).toBe(OFFLINE_QUEUE_STORAGE_KEY);
    expect(scanCursorKey(WALLET)).toBe(`${LOCAL_DATA_STORAGE_KEYS.scanCursorPrefix}${WALLET}`);
    expect(AUCTION_STORAGE_KEY).toBe(LOCAL_DATA_STORAGE_KEYS.auction);
    expect(VAULT_STORAGE_KEY).toBe(LOCAL_DATA_STORAGE_KEYS.auctionVault);
    expect(recipientVaultStorageKey(WALLET, 'C', 'passphrase')).toMatch(
      new RegExp(`^${LOCAL_DATA_STORAGE_KEYS.vaultReceivedPrefix}[0-9a-f]{16}:C:${WALLET}$`),
    );

    localStorage.setItem(
      `${LOCAL_DATA_STORAGE_KEYS.vaultSentPrefix}${WALLET}`,
      JSON.stringify([{ depositId: 'd' }]),
    );
    expect(loadPersistedVaultDeposits(WALLET)).toHaveLength(1);
  });

  it('matches the submission retry key', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      locks: { request: (_name: string, _options: unknown, work: () => unknown) => work() },
    });
    try {
      await reserveSubmissionOperationId('draft');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(localStorage.getItem(LOCAL_DATA_STORAGE_KEYS.submissions)).not.toBeNull();
  });
});
