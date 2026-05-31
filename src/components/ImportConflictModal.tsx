import { type ImportResult } from '@/lib/stealthLabels';

interface ImportConflictModalProps {
  conflicts: ImportResult['conflicts'];
  onResolve: (action: 'keep-all' | 'overwrite-all') => void;
  onClose: () => void;
}

export function ImportConflictModal({ conflicts, onResolve, onClose }: ImportConflictModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="mx-4 w-full max-w-lg border border-outline-variant bg-surface-container p-6">
        <h2 className="mb-1 font-heading text-lg font-bold uppercase tracking-tight text-on-surface">
          Import Conflicts
        </h2>
        <p className="mb-4 font-body text-xs text-on-surface-variant">
          {conflicts.length} label{conflicts.length !== 1 ? 's' : ''} already exist with different
          values.
        </p>

        <div className="mb-6 max-h-60 overflow-y-auto">
          {conflicts.map((c) => (
            <div
              key={c.stealthAddress}
              className="border-b border-outline-variant/30 py-3 last:border-0"
            >
              <code className="mb-1 block truncate font-mono text-[11px] text-primary">
                {c.stealthAddress}
              </code>
              <div className="flex gap-4">
                <div className="flex-1">
                  <span className="font-mono text-[9px] uppercase tracking-widest text-outline">
                    Current
                  </span>
                  <p className="text-xs text-on-surface">{c.existingLabel || '(empty)'}</p>
                </div>
                <div className="flex-1">
                  <span className="font-mono text-[9px] uppercase tracking-widest text-outline">
                    Incoming
                  </span>
                  <p className="text-xs text-on-surface">{c.incomingLabel || '(empty)'}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => onResolve('keep-all')}
            className="flex-1 border border-outline-variant py-2 font-heading text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
          >
            Keep Existing
          </button>
          <button
            onClick={() => onResolve('overwrite-all')}
            className="flex-1 bg-primary py-2 font-heading text-[10px] uppercase tracking-widest text-surface transition-colors hover:brightness-110"
          >
            Overwrite All
          </button>
          <button
            onClick={onClose}
            className="border border-outline-variant px-4 py-2 font-heading text-[10px] uppercase tracking-widest text-outline transition-colors hover:bg-surface-bright"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
