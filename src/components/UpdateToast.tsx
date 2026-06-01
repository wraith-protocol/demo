interface UpdateToastProps {
  onUpdate: () => void;
  onDismiss: () => void;
}

export function UpdateToast({ onUpdate, onDismiss }: UpdateToastProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 border border-outline bg-surface-container px-4 py-3 text-sm shadow-lg"
    >
      <span className="text-on-surface-variant">A new version is ready.</span>
      <button
        onClick={onUpdate}
        className="font-medium text-primary underline-offset-2 hover:underline"
      >
        Reload
      </button>
      <button
        onClick={onDismiss}
        aria-label="Dismiss update notification"
        className="ml-1 text-outline hover:text-on-surface"
      >
        ✕
      </button>
    </div>
  );
}
