import { createContext, useContext, useCallback, useRef, type ReactNode } from 'react';
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';

const STORAGE_KEY = 'wraith-tour-dismissed';

interface OnboardingContextValue {
  startTour: () => void;
  dismissTour: () => void;
  hasSeenTour: () => boolean;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

function buildTourSteps() {
  return [
    {
      // Step 1 – Welcome / overview (no element highlight)
      popover: {
        title: 'Welcome to Wraith Protocol',
        description:
          'This demo shows how to send and receive <strong>stealth payments</strong> — private transactions where every payment lands at a fresh, one-time address.\n\nThis tour takes under a minute. You can skip at any time.',
        side: 'over' as const,
        align: 'center' as const,
      },
    },
    {
      // Step 2 – Connect wallet (targets the WalletConnect button)
      element: '[data-tour="wallet-connect"]',
      popover: {
        title: 'Step 1 · Connect your wallet',
        description:
          'Start by connecting the wallet for your chosen chain — Freighter for Stellar, or a browser wallet for EVM/Solana/CKB.\n\nUse the chain switcher on the left to pick your network first.',
        side: 'bottom' as const,
        align: 'end' as const,
      },
    },
    {
      // Step 3 – Derive keys / sign message (targets the Derive Keys button on Receive page)
      element: '[data-tour="derive-keys"]',
      popover: {
        title: 'Step 2 · Derive your stealth keys',
        description:
          'Click <strong>Derive Keys</strong> to generate your stealth spending and viewing key pair. Your wallet will ask you to sign a message.\n\n<code style="font-family:\'JetBrains Mono\',monospace;font-size:11px;background:rgba(0,0,0,0.15);padding:2px 4px">SIGN THIS MESSAGE TO DERIVE YOUR STEALTH KEYS</code>\n\nThis is a <em>read-only signature</em> — no transaction is broadcast and no funds move. It derives your keys deterministically from your wallet, so you can always re-derive them.',
        side: 'bottom' as const,
        align: 'start' as const,
      },
    },
    {
      // Step 4 – Meta-address display
      element: '[data-tour="meta-address"]',
      popover: {
        title: 'Step 3 · Your stealth meta-address',
        description:
          'This is your <strong>stealth meta-address</strong> — share it like a regular address so senders can generate one-time stealth addresses that only you can spend.\n\nYou can register it on-chain so others can look you up by wallet address, or share it manually.',
        side: 'bottom' as const,
        align: 'start' as const,
      },
    },
    {
      // Step 5 – Scan for payments
      element: '[data-tour="scan-payments"]',
      popover: {
        title: 'Step 4 · Scan for payments',
        description:
          'Hit <strong>Scan for Payments</strong> to check the chain for any stealth transfers addressed to you.\n\nThe SDK scans on-chain announcements and matches them against your viewing key locally — your private key never leaves your browser.',
        side: 'top' as const,
        align: 'start' as const,
      },
    },
    {
      // Step 6 – Send flow summary
      element: '[data-tour="chain-switcher"]',
      popover: {
        title: 'Sending stealth payments',
        description:
          "To send, switch to the <strong>Send</strong> tab. Paste the recipient's stealth meta-address, enter an amount, and confirm. The SDK generates a fresh one-time address per transfer — the recipient's real address is never exposed on-chain.",
        side: 'bottom' as const,
        align: 'start' as const,
      },
    },
    {
      // Step 7 – Done
      popover: {
        title: "You're all set",
        description:
          "That's the full flow: connect → derive → share meta-address → scan.\n\nYou can restart this tour at any time from the <strong>Settings</strong> page.",
        side: 'over' as const,
        align: 'center' as const,
      },
    },
  ];
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const driverRef = useRef<ReturnType<typeof driver> | null>(null);

  const hasSeenTour = useCallback(() => {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  }, []);

  const dismissTour = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    if (driverRef.current) {
      driverRef.current.destroy();
      driverRef.current = null;
    }
  }, []);

  const startTour = useCallback(() => {
    // Destroy any running instance before starting fresh
    if (driverRef.current) {
      driverRef.current.destroy();
    }

    const driverInstance = driver({
      showProgress: true,
      animate: true,
      overlayOpacity: 0.6,
      smoothScroll: true,
      allowClose: true,
      // Custom popover styles to match the Wraith design system
      popoverClass: 'wraith-tour-popover',
      steps: buildTourSteps(),
      onDestroyed: () => {
        localStorage.setItem(STORAGE_KEY, 'true');
        driverRef.current = null;
      },
    });

    driverRef.current = driverInstance;
    driverInstance.drive();
  }, []);

  return (
    <OnboardingContext.Provider value={{ startTour, dismissTour, hasSeenTour }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider');
  return ctx;
}
