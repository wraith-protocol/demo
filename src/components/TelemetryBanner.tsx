import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getConsent, setConsent, type ConsentState } from '@/lib/telemetry';

export function TelemetryBanner() {
  const [consent, setConsentState] = useState<ConsentState>(null);

  useEffect(() => {
    setConsentState(getConsent());
  }, []);

  if (consent !== null) return null;

  function handleAccept() {
    setConsent('accepted');
    setConsentState('accepted');
  }

  function handleDecline() {
    setConsent('declined');
    setConsentState('declined');
  }

  return (
    <div className="border-b border-outline-variant bg-surface-container px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-[720px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-on-surface-variant">
          We use cookieless analytics to improve this demo.{' '}
          <Link to="/privacy" className="text-primary underline underline-offset-2">
            Privacy page
          </Link>
          . No wallet addresses or amounts are ever collected.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={handleDecline}
            className="border border-outline-variant px-3 py-1 text-xs text-on-surface-variant hover:border-outline hover:text-on-surface"
          >
            Decline
          </button>
          <button
            onClick={handleAccept}
            className="border border-primary px-3 py-1 text-xs text-primary hover:bg-primary hover:text-surface"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}