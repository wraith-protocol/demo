import { useCallback, useRef, useState, type SetStateAction } from 'react';
import { beginTransactionActivity } from '@/lib/transactionActivity';

/** Keep protecting an awaited operation even if its screen unmounts. */
export function useTransactionState<T>(initial: T, active: (value: T) => boolean) {
  const [value, setValue] = useState(initial);
  const current = useRef(initial);
  const finish = useRef<(() => void) | undefined>(undefined);
  const update = useCallback(
    (next: SetStateAction<T>) => {
      const resolved = next instanceof Function ? next(current.current) : next;
      current.current = resolved;
      if (active(resolved)) finish.current ??= beginTransactionActivity('submitting');
      else {
        finish.current?.();
        finish.current = undefined;
      }
      setValue(resolved);
    },
    [active],
  );
  return [value, update] as const;
}
