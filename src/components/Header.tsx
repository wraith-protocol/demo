import { Link, useLocation } from 'react-router-dom';
import { ChainSwitcher } from './ChainSwitcher';
import { WalletConnect } from './WalletConnect';

const navLinks = [
  { to: '/send', label: 'Send' },
  { to: '/receive', label: 'Receive' },
];

export function Header() {
  const location = useLocation();

  return (
    <header className="border-b border-outline-variant bg-surface">
      <div className="mx-auto flex max-w-[720px] flex-col gap-3 px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
        <div className="flex items-center justify-between">
          <Link to="/send" className="flex items-center gap-2">
            <img src="/logo.png" alt="Wraith" className="h-6 w-6" />
            <span className="font-heading text-sm font-bold uppercase tracking-widest text-primary sm:text-lg">
              Wraith Demo
            </span>
          </Link>
          <WalletConnect />
        </div>
        <div className="flex items-center justify-between">
          <ChainSwitcher />
          <nav className="flex gap-0">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`px-4 py-2 font-heading text-[10px] uppercase tracking-widest transition-colors sm:text-xs ${
                  location.pathname === link.to
                    ? 'border-b-2 border-primary text-primary'
                    : 'border-b-2 border-transparent text-on-surface-variant hover:text-primary'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
