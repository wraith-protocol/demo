import { useCallback, useEffect, useState, type SetStateAction } from 'react';
import { APP_VERSION } from '@/lib/appCompatibility';

/** Per-tab unsigned form data only; never persist wallet secrets or signed envelopes here. */
export function useSendDraft<T extends string>(key: string, initial: T) {
  const storageKey = `wraith-send-draft:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return initial;
      const saved = JSON.parse(raw);
      return saved.version === APP_VERSION.transactionSchema && typeof saved.data === 'string'
        ? (saved.data as T)
        : initial;
    } catch {
      return initial;
    }
  });
  const persist = useCallback(
    (next: T) => {
      const existing = sessionStorage.getItem(storageKey);
      if (existing && JSON.parse(existing).version !== APP_VERSION.transactionSchema) {
        throw new Error('The saved draft belongs to a different application version.');
      }
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ version: APP_VERSION.transactionSchema, data: next }),
      );
    },
    [storageKey],
  );
  const update = useCallback(
    (next: SetStateAction<T>) => {
      setValue((previous) => {
        const resolved = typeof next === 'function' ? next(previous) : next;
        try {
          persist(resolved);
        } catch {
          /* The update prepare step retries and vetoes on failure. */
        }
        return resolved;
      });
    },
    [persist],
  );
  useEffect(() => {
    const save = (event: Event) => {
      try {
        persist(value);
      } catch {
        event.preventDefault();
      }
    };
    window.addEventListener('wraith:save-drafts', save);
    return () => window.removeEventListener('wraith:save-drafts', save);
  }, [persist, value]);
  return [value, update] as const;
}
