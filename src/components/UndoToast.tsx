import { useEffect, useState } from 'react';
import { useUndoStore } from '@/stores/undoStore';

function ToastItem({
  id,
  message,
  onUndo,
  expiresAt,
}: {
  id: string;
  message: string;
  onUndo: () => void;
  expiresAt: number;
}) {
  const removeToast = useUndoStore((s) => s.removeToast);
  const [remaining, setRemaining] = useState(5);

  useEffect(() => {
    const interval = setInterval(() => {
      const secs = Math.ceil((expiresAt - Date.now()) / 1000);
      setRemaining(secs > 0 ? secs : 0);
    }, 200);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const handleUndo = () => {
    onUndo();
    removeToast(id);
  };

  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface-variant px-4 py-3 shadow-lg">
      <span className="font-body text-sm text-on-surface-variant flex-1">{message}</span>
      <button
        onClick={handleUndo}
        className="font-body text-sm font-semibold text-primary hover:underline"
      >
        Undo
      </button>
      <span className="font-mono text-xs text-on-surface-variant opacity-60 w-4 text-right">
        {remaining}s
      </span>
      <button
        onClick={() => removeToast(id)}
        className="text-on-surface-variant opacity-60 hover:opacity-100 text-lg leading-none"
      >
        ×
      </button>
    </div>
  );
}

export function UndoToast() {
  const toasts = useUndoStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 w-full max-w-sm px-4">
      {toasts.map((t) => (
        <ToastItem key={t.id} {...t} />
      ))}
    </div>
  );
}
