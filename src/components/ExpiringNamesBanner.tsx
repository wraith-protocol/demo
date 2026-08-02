import { useEffect, useState } from 'react';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { getOwnedNames, getNameRecord } from '@/lib/stellar/names';
import { Link } from 'react-router-dom';

interface OwnedName {
  name: string;
  expiresAt: number;
}

export function ExpiringNamesBanner() {
  const { address, isConnected } = useStellarWallet();
  const [expiringCount, setExpiringCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isConnected || !address) {
      setExpiringCount(0);
      return;
    }

    const checkExpiringNames = async () => {
      setIsLoading(true);
      try {
        const names = await getOwnedNames(address);
        const records = await Promise.all(
          names.map(async (name) => {
            const record = await getNameRecord(name);
            return {
              name,
              expiresAt: record?.expires_at || 0,
            };
          }),
        );

        const now = Math.floor(Date.now() / 1000);
        const thirtyDays = 30 * 24 * 60 * 60;
        const expiring = records.filter((n) => n.expiresAt - now < thirtyDays && n.expiresAt > now);
        setExpiringCount(expiring.length);
      } catch {
        setExpiringCount(0);
      } finally {
        setIsLoading(false);
      }
    };

    checkExpiringNames();
  }, [isConnected, address]);

  if (!isConnected || isLoading || expiringCount === 0) {
    return null;
  }

  return (
    <div className="border border-tertiary bg-surface-container p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-tertiary">⚠</span>
          <span className="font-heading text-xs font-semibold uppercase tracking-widest text-on-surface">
            Names Expiring Soon
          </span>
        </div>
        <Link
          to="/names"
          className="font-heading text-[10px] uppercase tracking-widest text-primary underline"
        >
          Manage
        </Link>
      </div>
      <p className="mt-2 font-body text-sm text-on-surface-variant">
        {expiringCount} name{expiringCount !== 1 ? 's' : ''} will expire within 30 days.
      </p>
    </div>
  );
}
