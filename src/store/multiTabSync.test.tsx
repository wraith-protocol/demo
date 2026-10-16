/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ContactsProvider, useContacts } from './contactsStore';
import {
  ScanStrategyProvider,
  useScanStrategy,
  DEFAULT_SCAN_STRATEGY,
} from '../context/ScanStrategyContext';
import { SplitTemplatesProvider, useSplitTemplates } from './splitTemplatesStore';
import {
  useNameWatchlistStore,
  initNameWatchlistSync,
  cleanupNameWatchlistSync,
} from './nameWatchlistStore';
import { useStealthLabels } from '../hooks/useStealthLabels';

describe('Multi-tab synchronization', () => {
  beforeEach(() => {
    localStorage.clear();
    initNameWatchlistSync();
  });

  afterEach(() => {
    cleanupNameWatchlistSync();
  });

  it('synchronizes contacts between tabs', () => {
    const { result } = renderHook(() => useContacts(), { wrapper: ContactsProvider });

    expect(result.current.contacts).toEqual([]);

    // Simulate another tab adding a contact
    const newContacts = [{ address: 'G123', name: 'Alice', addedAt: Date.now() }];
    act(() => {
      localStorage.setItem('wraith-contacts', JSON.stringify(newContacts));
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'wraith-contacts',
          newValue: JSON.stringify(newContacts),
        }),
      );
    });

    expect(result.current.contacts).toEqual(newContacts);

    // Simulate another tab clearing data
    act(() => {
      localStorage.removeItem('wraith-contacts');
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'wraith-contacts',
          newValue: null,
        }),
      );
    });

    expect(result.current.contacts).toEqual([]);
  });

  it('synchronizes deletions between tabs', () => {
    const { result } = renderHook(() => useContacts(), { wrapper: ContactsProvider });

    const newContacts = [
      { address: 'G123', name: 'Alice', addedAt: Date.now() },
      { address: 'G456', name: 'Bob', addedAt: Date.now() },
    ];

    // Simulate initial setup from another tab
    act(() => {
      localStorage.setItem('wraith-contacts', JSON.stringify(newContacts));
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'wraith-contacts',
          newValue: JSON.stringify(newContacts),
        }),
      );
    });

    expect(result.current.contacts).toEqual(newContacts);

    // Simulate another tab deleting a contact
    const deletedContacts = [newContacts[1]]; // keeps Bob, deletes Alice

    act(() => {
      localStorage.setItem('wraith-contacts', JSON.stringify(deletedContacts));
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'wraith-contacts',
          newValue: JSON.stringify(deletedContacts),
        }),
      );
    });

    expect(result.current.contacts).toEqual(deletedContacts);
  });

  it('synchronizes scan strategy between tabs', () => {
    const { result } = renderHook(() => useScanStrategy(), { wrapper: ScanStrategyProvider });

    expect(result.current.strategy).toBe(DEFAULT_SCAN_STRATEGY);

    // Simulate another tab changing strategy
    act(() => {
      localStorage.setItem('wraith-scan-strategy', 'fast');
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'wraith-scan-strategy',
          newValue: 'fast',
        }),
      );
    });

    expect(result.current.strategy).toBe('fast');

    // Simulate clear
    act(() => {
      localStorage.clear();
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: null,
        }),
      );
    });

    expect(result.current.strategy).toBe(DEFAULT_SCAN_STRATEGY);
  });

  it('synchronizes templates between tabs', () => {
    const { result } = renderHook(() => useSplitTemplates(), { wrapper: SplitTemplatesProvider });

    expect(result.current.templates).toEqual([]);

    const newTemplates = [{ id: 'tpl_1', name: 'Test', rows: [], createdAt: 1, updatedAt: 1 }];

    act(() => {
      localStorage.setItem(
        'wraith-split-templates',
        JSON.stringify({ version: 1, type: 'wraith-versioned-collection', data: newTemplates }),
      );
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'wraith-split-templates',
          newValue: JSON.stringify({
            version: 1,
            type: 'wraith-versioned-collection',
            data: newTemplates,
          }),
        }),
      );
    });

    expect(result.current.templates).toEqual(newTemplates);
  });

  it('synchronizes watchlists between tabs', () => {
    const { result } = renderHook(() => useNameWatchlistStore());

    expect(result.current.watchedAuctions).toEqual([]);

    const payload = { watchedAuctions: [{ name: 'test.xlm', endsAt: 1 }], bids: {} };

    act(() => {
      const storageState = JSON.stringify({
        version: 1,
        type: 'wraith-versioned-value',
        data: payload,
      });
      localStorage.setItem('wraith-name-auction-watchlist', storageState);
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'wraith-name-auction-watchlist',
          newValue: storageState,
        }),
      );
    });

    expect(result.current.watchedAuctions.length).toBe(1);
    expect(result.current.watchedAuctions[0].name).toBe('test.xlm');
  });

  it('synchronizes wallet labels between tabs', () => {
    const { result } = renderHook(() => useStealthLabels('PUB1'));

    expect(result.current.labels).toEqual({});

    const label = { stealthAddress: 'st1', label: 'My Label', tags: [], createdAt: 1 };

    act(() => {
      localStorage.setItem('PUB1:st1', JSON.stringify(label));
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'PUB1:st1',
          newValue: JSON.stringify(label),
        }),
      );
    });

    expect(result.current.labels['st1']).toEqual(label);
  });

  it('handles global clear-data correctly across all states', () => {
    const { result: contactsRes } = renderHook(() => useContacts(), { wrapper: ContactsProvider });
    const { result: templatesRes } = renderHook(() => useSplitTemplates(), {
      wrapper: SplitTemplatesProvider,
    });
    const { result: watchlistRes } = renderHook(() => useNameWatchlistStore());
    const { result: labelsRes } = renderHook(() => useStealthLabels('PUB1'));

    // Set initial data
    act(() => {
      contactsRes.current.addContact('G123', 'Alice');
      templatesRes.current.saveTemplate('Test', []);
      watchlistRes.current.watchAuction({ name: 'test.xlm', endsAt: 1 });
      labelsRes.current.saveLabel('st1', 'My Label', []);
    });

    // Verify data exists
    expect(contactsRes.current.contacts.length).toBeGreaterThan(0);
    expect(templatesRes.current.templates.length).toBeGreaterThan(0);
    expect(watchlistRes.current.watchedAuctions.length).toBeGreaterThan(0);
    expect(Object.keys(labelsRes.current.labels).length).toBeGreaterThan(0);

    // Simulate clear data (logout)
    act(() => {
      localStorage.clear();
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: null,
          newValue: null,
        }),
      );
    });

    // Everything should be empty
    expect(contactsRes.current.contacts).toEqual([]);
    expect(templatesRes.current.templates).toEqual([]);
    expect(watchlistRes.current.watchedAuctions).toEqual([]);
    expect(labelsRes.current.labels).toEqual({});
  });
});
