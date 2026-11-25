// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useTransactionState } from './useTransactionState';
import {
  activeTransactionReason,
  cancelPreparedUpdate,
  prepareForUpdate,
} from '@/lib/transactionActivity';

afterEach(cancelPreparedUpdate);

it('protects a transaction after navigation until its asynchronous finally clears busy state', () => {
  const { result, unmount } = renderHook(() => useTransactionState<boolean>(false, Boolean));
  const setPending = result.current[1];
  act(() => setPending(true));
  expect(prepareForUpdate()).toBe(false);
  unmount();
  expect(prepareForUpdate()).toBe(false);
  act(() => setPending(false));
  expect(activeTransactionReason()).toBeNull();
  expect(prepareForUpdate()).toBe(true);
});
