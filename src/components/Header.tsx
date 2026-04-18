import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChainSwitcher } from './ChainSwitcher';
import { WalletConnect } from './WalletConnect';

const navLinks = [
  { to: '/send', label: 'Send' },
  { to: '/receive', label: 'Receive' },
];

export function Header() {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="border-b border-outline-variant bg-surface">
      <div className="mx-auto flex max-w-[720px] items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-center gap-4">
          <Link to="/send" className="flex items-center gap-2">
            <img src="/logo.png" alt="Wraith" className="h-5 w-5 sm:h-6 sm:w-6" />
            <span className="font-heading text-sm font-bold uppercase tracking-widest text-on-surface sm:text-base">
              Wraith
            </span>
            <span className="bg-surface-bright px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-outline sm:text-[10px]">
              Demo
            </span>
          </Link>

          <nav className="hidden gap-0 sm:flex">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`px-4 py-2 font-heading text-xs uppercase tracking-widest transition-colors ${
                  location.pathname === link.to
                    ? 'border-b-[1.5px] border-tertiary text-on-surface'
                    : 'border-b-[1.5px] border-transparent text-outline hover:text-on-surface-variant'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <ChainSwitcher />
          <WalletConnect />
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="flex h-8 w-8 items-center justify-center text-outline transition-colors hover:text-on-surface-variant sm:hidden"
            aria-label="Menu"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              {mobileMenuOpen ? (
                <>
                  <path d="M4 4l8 8" strokeLinecap="square" />
                  <path d="M12 4l-8 8" strokeLinecap="square" />
                </>
              ) : (
                <>
                  <path d="M2 4h12" strokeLinecap="square" />
                  <path d="M2 8h12" strokeLinecap="square" />
                  <path d="M2 12h12" strokeLinecap="square" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="border-t border-outline-variant/30 px-4 pb-3 sm:hidden">
          <nav className="flex gap-0">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMobileMenuOpen(false)}
                className={`px-4 py-2.5 font-heading text-[10px] uppercase tracking-widest transition-colors ${
                  location.pathname === link.to
                    ? 'border-b-[1.5px] border-tertiary text-on-surface'
                    : 'border-b-[1.5px] border-transparent text-outline hover:text-on-surface-variant'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
