import { useCallback } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import en from '@/i18n/en.json';

const TOUR_KEY = 'wraith.tourCompleted';

const t = en.onboardingTour;

function buildDriver(onDone: () => void) {
  const prefersReducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return driver({
    animate: !prefersReducedMotion,
    allowClose: true,
    overlayOpacity: 0,
    stagePadding: 6,
    popoverClass: 'wraith-tour-popover',
    nextBtnText: t.nextBtn,
    prevBtnText: t.prevBtn,
    doneBtnText: t.doneBtn,
    showProgress: true,
    onDestroyStarted: () => {
      onDone();
    },
    steps: [
      {
        element: '[data-tour="wallet-connect"]',
        popover: {
          title: t.step1.title,
          description: t.step1.description,
          side: 'bottom',
          align: 'end',
        },
      },
      {
        element: '[data-tour="wallet-connect"]',
        popover: {
          title: t.step2.title,
          description: t.step2.description,
          side: 'bottom',
          align: 'end',
        },
      },
      {
        element: '[data-tour="recipient-input"]',
        popover: {
          title: t.step3.title,
          description: t.step3.description,
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="amount-input"]',
        popover: {
          title: t.step4.title,
          description: t.step4.description,
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="send-button"]',
        popover: {
          title: t.step5.title,
          description: t.step5.description,
          side: 'top',
          align: 'start',
        },
      },
    ],
  });
}

export function useStellarTour() {
  const isCompleted = () => localStorage.getItem(TOUR_KEY) === 'true';

  const markCompleted = useCallback(() => {
    localStorage.setItem(TOUR_KEY, 'true');
  }, []);

  const startTour = useCallback(
    (force = false) => {
      if (!force && isCompleted()) return;
      const driverObj = buildDriver(markCompleted);
      driverObj.drive();
    },
    [markCompleted],
  );

  return { startTour, isCompleted };
}
