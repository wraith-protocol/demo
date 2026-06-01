import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!deferredPrompt || dismissed) return null;

  const handleInstall = async () => {
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted' || outcome === 'dismissed') {
      setDeferredPrompt(null);
    }
  };

  return (
    <div className="fixed bottom-6 right-4 z-50 flex items-center gap-2 border border-outline bg-surface-container px-4 py-3 text-sm shadow-lg sm:right-6">
      <span className="text-on-surface-variant">Install Wraith</span>
      <button
        onClick={handleInstall}
        className="font-medium text-primary underline-offset-2 hover:underline"
      >
        Add to home screen
      </button>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss install prompt"
        className="ml-1 text-outline hover:text-on-surface"
      >
        ✕
      </button>
    </div>
  );
}
