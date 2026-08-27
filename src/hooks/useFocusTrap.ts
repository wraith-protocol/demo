import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'details > summary',
].join(', ');

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)).filter(
    (el) => !el.closest('[hidden]') && getComputedStyle(el).display !== 'none',
  );
}

interface UseFocusTrapOptions {
  /** Whether the trap is currently active. Trap is installed only when true. */
  isActive: boolean;
  /**
   * Ref to the container element whose focusable descendants are trapped.
   * Must be set before isActive becomes true.
   */
  containerRef: React.RefObject<HTMLElement | null>;
  /**
   * Optional ref to the element that should receive initial focus.
   * When omitted, the first focusable element inside containerRef is used.
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * Optional ref to the element that triggered the dialog.
   * Focus is returned here when the trap is deactivated.
   * When omitted, focus returns to document.activeElement at activation time.
   */
  triggerRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Traps keyboard focus within a container element while a dialog is open.
 *
 * - Tab / Shift+Tab cycle stays inside the container.
 * - On activation, focuses initialFocusRef (or first focusable element).
 * - On deactivation, returns focus to triggerRef (or the element that had
 *   focus when the trap was first activated).
 */
export function useFocusTrap({
  isActive,
  containerRef,
  initialFocusRef,
  triggerRef,
}: UseFocusTrapOptions): void {
  // Capture the element that had focus *before* the trap activates.
  const previousFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!isActive) return;

    // Capture the currently focused element so we can restore it on close.
    previousFocusRef.current = document.activeElement;

    const container = containerRef.current;
    if (!container) return;

    // Move focus to the requested initial element, or the first focusable one.
    const setInitialFocus = () => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus();
      } else {
        const focusable = getFocusableElements(container);
        if (focusable.length > 0) focusable[0].focus();
      }
    };

    // Small rAF delay so the container is fully painted before focusing.
    const rafId = requestAnimationFrame(setInitialFocus);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusable = getFocusableElements(container);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey) {
        // Shift+Tab: if focus is on (or before) the first element, wrap to last.
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: if focus is on (or after) the last element, wrap to first.
        if (active === last || !container.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('keydown', handleKeyDown);

      // Return focus to the trigger element, or to whatever had focus before.
      const returnTarget = triggerRef?.current ?? (previousFocusRef.current as HTMLElement | null);
      if (returnTarget && typeof returnTarget.focus === 'function') {
        returnTarget.focus();
      }
    };
  }, [isActive, containerRef, initialFocusRef, triggerRef]);
}
