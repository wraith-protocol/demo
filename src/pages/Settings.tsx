import { useEffect } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { useOnboarding } from '@/context/OnboardingContext';
import { trackPageView } from '@/lib/telemetry';

export default function Settings() {
  const { theme, toggleTheme } = useTheme();
  const { startTour, dismissTour, hasSeenTour } = useOnboarding();

  useEffect(() => {
    trackPageView('/settings');
  }, []);

  const handleRestartTour = () => {
    // Clear the dismissal flag and restart
    dismissTour(); // destroys any running instance
    // Re-clear the storage key so startTour will run (dismissTour sets it to true, we want fresh start)
    localStorage.removeItem('wraith-tour-dismissed');
    startTour();
  };

  const handleResetTour = () => {
    localStorage.removeItem('wraith-tour-dismissed');
  };

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-heading text-2xl font-semibold uppercase tracking-tight text-on-surface">
          Settings
        </h1>
        <p className="mt-2 text-sm text-on-surface-variant">
          Preferences and app configuration.
        </p>
      </div>

      {/* Appearance */}
      <section className="space-y-4">
        <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-outline">
          Appearance
        </h2>
        <div className="border border-outline-variant bg-surface-container p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-heading text-sm font-medium text-on-surface">Theme</p>
              <p className="mt-0.5 text-xs text-on-surface-variant">
                Switch between light and dark mode.
              </p>
            </div>
            <button
              onClick={toggleTheme}
              className="h-9 border border-outline-variant px-4 font-heading text-[10px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
            >
              {theme === 'light' ? 'Switch to Dark' : 'Switch to Light'}
            </button>
          </div>
        </div>
      </section>

      {/* Onboarding Tour */}
      <section className="space-y-4">
        <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-outline">
          Onboarding
        </h2>
        <div className="border border-outline-variant bg-surface-container p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-heading text-sm font-medium text-on-surface">Product Tour</p>
              <p className="mt-0.5 text-xs text-on-surface-variant">
                A guided walkthrough of the full stealth payment flow: connect wallet → derive keys
                → share meta-address → scan for payments.
              </p>
              <p className="mt-2 text-xs text-on-surface-variant">
                Tour status:{' '}
                <span className="font-mono text-primary">
                  {hasSeenTour() ? 'completed' : 'not yet seen'}
                </span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-1">
            <button
              onClick={handleRestartTour}
              className="h-10 bg-primary px-5 font-heading text-[11px] font-semibold uppercase tracking-widest text-surface transition-colors hover:brightness-110"
            >
              Start Tour
            </button>
            {hasSeenTour() && (
              <button
                onClick={handleResetTour}
                className="h-10 border border-outline-variant px-5 font-heading text-[11px] font-semibold uppercase tracking-widest text-outline transition-colors hover:bg-surface-bright hover:text-on-surface-variant"
              >
                Reset (show on next visit)
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Data & Privacy */}
      <section className="space-y-4">
        <h2 className="font-heading text-xs font-semibold uppercase tracking-widest text-outline">
          Data &amp; Privacy
        </h2>
        <div className="border border-outline-variant bg-surface-container p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-heading text-sm font-medium text-on-surface">
                Analytics opt-in
              </p>
              <p className="mt-0.5 text-xs text-on-surface-variant">
                Manage your analytics preference by clearing local storage, or visit the{' '}
                <a href="/privacy" className="text-primary underline">
                  Privacy Policy
                </a>
                .
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
