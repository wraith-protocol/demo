import type { ReactNode } from 'react';
import { CopyButton } from '@/components/CopyButton';
import {
  stellarExpertUrl,
  type StellarExpertNetworkInput,
  type StellarExpertResource,
} from '@/utils/stellarExpert';

interface StellarLinkProps {
  value: string;
  type: StellarExpertResource;
  network?: StellarExpertNetworkInput;
  children?: ReactNode;
  className?: string;
  linkClassName?: string;
}

function truncateIdentifier(value: string): string {
  if (value.length <= 28) return value;
  return `${value.slice(0, 12)}...${value.slice(-12)}`;
}

export function StellarLink({
  value,
  type,
  network,
  children,
  className = '',
  linkClassName = '',
}: StellarLinkProps) {
  const resourceLabel = type === 'tx' ? 'transaction' : type;

  return (
    <span className={`inline-flex min-w-0 items-center gap-2 ${className}`}>
      <a
        href={stellarExpertUrl(type, value, network)}
        target="_blank"
        rel="noopener noreferrer"
        title={value}
        aria-label={`View Stellar ${resourceLabel} ${value} on Stellar Expert`}
        className={`min-w-0 truncate font-mono text-tertiary underline decoration-outline underline-offset-2 transition-colors hover:text-primary ${linkClassName}`}
      >
        {children ?? truncateIdentifier(value)}
      </a>
      <CopyButton text={value} />
    </span>
  );
}
