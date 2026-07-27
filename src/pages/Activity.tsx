import { useEffect } from 'react';
import { StellarReceive } from '@/components/StellarReceive';
import { trackPageView } from '@/lib/telemetry';

/**
 * Activity page for managing stealth deposits and executing multi-select batch withdrawals.
 */
export default function Activity() {
  useEffect(() => {
    trackPageView('/activity');
  }, []);

  return <StellarReceive />;
}
