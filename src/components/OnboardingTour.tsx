import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import copy from '@/i18n/en.json';
import { useChain } from '@/context/ChainContext';

const STORAGE_KEY = 'wraith.tourCompleted';
const EVENT_NAME = 'wraith:restart-tour';

type TourStep = (typeof copy.onboarding.steps)[number];

function interpolate(template: string, values: Record<string, number>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ''));
}

function isReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function restartOnboardingTour() {
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function OnboardingTour() {
  const location = useLocation();
  const navigate = useNavigate();
  const { chain, setChain } = useChain();
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const steps = copy.onboarding.steps;
  const currentStep: TourStep = steps[index];
  const isLastStep = index === steps.length - 1;
  const targetSelector = `[data-tour="${currentStep.target}"]`;

  const start = useCallback(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    if (location.pathname !== '/send') navigate('/send');
    if (chain !== 'stellar') setChain('stellar');
    setIndex(0);
    setActive(true);
  }, [chain, location.pathname, navigate, setChain]);

  const finish = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setActive(false);
    previousFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    if (location.pathname === '/send' || location.pathname === '/') start();
  }, [location.pathname, start]);

  useEffect(() => {
    const restart = () => start();
    window.addEventListener(EVENT_NAME, restart);
    return () => window.removeEventListener(EVENT_NAME, restart);
  }, [start]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, finish]);

  useEffect(() => {
    if (!active) return;
    window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>('button')?.focus(), 0);
  }, [active, index]);

  useEffect(() => {
    if (!active) return;
    const target = document.querySelector<HTMLElement>(targetSelector);
    target?.scrollIntoView({
      block: 'center',
      behavior: isReducedMotion() ? 'auto' : 'smooth',
    });
  }, [active, targetSelector]);

  const next = () => {
    if (isLastStep) {
      finish();
      return;
    }
    setIndex((nextIndex) => Math.min(nextIndex + 1, steps.length - 1));
  };

  if (!active) return null;

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-40 bg-black/45" aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby="wraith-tour-title"
        aria-describedby="wraith-tour-body"
        className="fixed bottom-4 left-4 right-4 z-50 border border-outline-variant bg-surface-container p-4 shadow-2xl sm:bottom-6 sm:left-auto sm:right-6 sm:w-[360px] sm:p-5"
      >
        <div className="flex flex-col gap-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-outline">
            {interpolate(copy.onboarding.stepCount, {
              current: index + 1,
              total: steps.length,
            })}
          </span>
          <div className="flex flex-col gap-2">
            <h2
              id="wraith-tour-title"
              className="font-heading text-sm font-bold uppercase tracking-widest text-on-surface"
            >
              {currentStep.title}
            </h2>
            <p
              id="wraith-tour-body"
              className="font-body text-sm leading-relaxed text-on-surface-variant"
            >
              {currentStep.body}
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={finish}
              className="font-heading text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-on-surface"
            >
              {copy.onboarding.skip}
            </button>
            <button
              type="button"
              onClick={next}
              className="h-9 border border-primary px-4 font-heading text-[10px] uppercase tracking-widest text-primary transition-colors hover:bg-surface-bright"
            >
              {isLastStep ? copy.onboarding.done : copy.onboarding.next}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
