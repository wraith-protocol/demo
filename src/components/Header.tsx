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
      <div className="mx-auto flex max-w-[720px] flex-col gap-4 px-6 py-4">
        <div className="flex items-center justify-between">
          <Link to="/send" className="flex items-center gap-2">
            <span className="font-heading text-lg font-bold uppercase tracking-widest text-primary">
              Wraith Demo
            </span>
          </Link>
          <WalletConnect />
        </div>
        <div className="flex items-center justify-between">
          <ChainSwitcher />
          <nav className="flex gap-4">
            {navLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={`font-heading text-xs uppercase tracking-widest transition-colors ${
                  location.pathname === link.to
                    ? 'text-primary'
                    : 'text-on-surface-variant hover:text-primary'
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
