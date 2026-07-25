import { useEffect } from 'react';
import { trackPageView } from '@/lib/telemetry';

export default function Privacy() {
  useEffect(() => {
    trackPageView('/privacy');
  }, []);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-on-surface">Privacy Policy</h1>
        <p className="mt-2 text-sm text-on-surface-variant">Last updated: June 2026</p>
      </div>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-medium text-on-surface">What we collect</h2>
        <p className="text-sm leading-relaxed text-on-surface-variant">
          If you opt in to analytics, we collect the following — nothing more:
        </p>
        <ul className="space-y-2 text-sm text-on-surface-variant">
          <li className="flex gap-2">
            <span className="text-tertiary">→</span> Page views (which page you visited)
          </li>
          <li className="flex gap-2">
            <span className="text-tertiary">→</span> Key flow events: connect wallet, send
            submitted, scan triggered, withdraw
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-medium text-on-surface">What we never collect</h2>
        <ul className="space-y-2 text-sm text-on-surface-variant">
          <li className="flex gap-2">
            <span className="text-error">✕</span> Wallet addresses
          </li>
          <li className="flex gap-2">
            <span className="text-error">✕</span> Transaction amounts
          </li>
          <li className="flex gap-2">
            <span className="text-error">✕</span> IP addresses
          </li>
          <li className="flex gap-2">
            <span className="text-error">✕</span> Cookies or cross-site tracking
          </li>
          <li className="flex gap-2">
            <span className="text-error">✕</span> Any personally identifiable information
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-medium text-on-surface">Provider</h2>
        <p className="text-sm leading-relaxed text-on-surface-variant">
          We use <span className="font-mono text-primary">Plausible Analytics</span> — a cookieless,
          privacy-respecting analytics tool that does not use cookies and is fully compliant with
          GDPR, CCPA, and PECR. No data is sold or shared with third parties.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-medium text-on-surface">Your choice</h2>
        <p className="text-sm leading-relaxed text-on-surface-variant">
          Analytics is strictly opt-in. You are asked once on your first visit. You can change your
          choice at any time by clearing your browser's local storage for this site.
        </p>
      </section>
    </div>
  );
}
