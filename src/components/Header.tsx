import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChainSwitcher } from './ChainSwitcher';
import { WalletConnect } from './WalletConnect';
import { LocaleSwitcher } from './LocaleSwitcher';
import { useTheme } from '@/context/ThemeContext';

export function Header() {
  const location = useLocation();
  const { t } = useTranslation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  const navLinks = [
    { to: '/send', label: t('nav.send') },
    { to: '/receive', label: t('nav.receive') },
    { to: '/schedule', label: t('nav.schedule') },
  ];

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

        <div className="flex items-center gap-2 sm:gap-3">
          <LocaleSwitcher />
          <button
            onClick={toggleTheme}
            className="flex h-8 w-8 items-center justify-center text-outline transition-colors hover:text-on-surface-variant"
            aria-label="Toggle theme"
          >
            {theme === 'light' ? (
              <svg
                className="h-4 w-4"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M8 1v2M8 13v2M3 8h2M11 8h2M4.5 4.5l1.4 1.4M10.1 10.1l1.4 1.4M4.5 11.5l1.4-1.4M10.1 5.9l1.4-1.4M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" />
              </svg>
            ) : (
              <svg
                className="h-4 w-4"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M12 9a4 4 0 1 1-8 0 4 4 0 0 1 8 0z" />
                <path d="M10 2a6 6 0 0 0-6 6" />
              </svg>
            )}
          </button>
          <div className="hidden sm:flex sm:items-center sm:gap-3">
            <ChainSwitcher />
            <WalletConnect />
          </div>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="flex h-8 w-8 items-center justify-center text-outline transition-colors hover:text-on-surface-variant sm:hidden"
            aria-label={t('header.menuLabel')}
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
        <div className="border-t border-outline-variant/30 px-4 pb-4 sm:hidden">
          <nav className="flex flex-col gap-0">
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
          <div className="mt-4 flex flex-col gap-3 border-t border-outline-variant/30 pt-4">
            <div className="flex items-center justify-between gap-3">
              <span className="font-heading text-[10px] uppercase tracking-widest text-outline">
                {t('header.chain')}
              </span>
              <ChainSwitcher />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-heading text-[10px] uppercase tracking-widest text-outline">
                {t('header.wallet')}
              </span>
              <WalletConnect />
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
