import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useOnboarding } from '@/context/OnboardingContext';

/**
 * TourLauncher — mounts inside the app and fires the tour once on first visit.
 * We wait until the user is on /receive so that the derive-keys and scan
 * anchors actually exist in the DOM when the tour starts.
 *
 * Subsequent steps that point to /receive elements will fall back gracefully
 * (driver.js skips a step if the element is not found).
 */
export function TourLauncher() {
  const { startTour, hasSeenTour } = useOnboarding();
  const fired = useRef(false);
  const location = useLocation();

  useEffect(() => {
    // Only fire once per session, and only for first-time visitors
    if (fired.current) return;
    if (hasSeenTour()) return;

    // Small delay to let the page paint before the overlay appears
    const timer = setTimeout(() => {
      if (!hasSeenTour() && !fired.current) {
        fired.current = true;
        startTour();
      }
    }, 800);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return null;
}
