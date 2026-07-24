import { useState, useEffect } from 'react';
import { reflectorOracle } from '@/lib/stellar/reflector';
import { useTranslation } from 'react-i18next';
import { useSettings } from '@/context/SettingsContext';

export interface AmountDisplayProps {
  amount: string;
  asset: 'XLM' | 'USDC' | 'ETH' | 'SOL' | 'CKB';
  showFiat?: boolean;
  className?: string;
}

export function AmountDisplay({
  amount,
  asset,
  showFiat = true,
  className = '',
}: AmountDisplayProps) {
  const { t } = useTranslation();
  const { currency } = useSettings();
  const [fiatAmount, setFiatAmount] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!showFiat) {
      setFiatAmount(null);
      return;
    }

    const fetchFiatAmount = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const prices = await reflectorOracle.fetchPrices();
        const price = prices[asset]?.price;

        if (price && !isNaN(parseFloat(amount))) {
          const fiat = parseFloat(amount) * price;

          if (currency === 'EUR') {
            setFiatAmount(`€${fiat.toFixed(2)}`);
          } else if (currency === 'GBP') {
            setFiatAmount(`£${fiat.toFixed(2)}`);
          } else if (currency === 'NGN') {
            setFiatAmount(`₦${fiat.toFixed(2)}`);
          } else {
            setFiatAmount(`$${fiat.toFixed(2)}`);
          }
        } else {
          setFiatAmount(null);
        }
      } catch (err) {
        console.error('Failed to fetch fiat amount:', err);
        setError(t('common.fiatConversionFailed'));
      } finally {
        setIsLoading(false);
      }
    };

    fetchFiatAmount();
  }, [amount, asset, showFiat, t, currency]);

  return (
    <span className={`inline-flex items-baseline gap-1 ${className}`}>
      {amount}
      {showFiat && fiatAmount && !isLoading && !error && (
        <span className="text-xs text-on-surface-variant">
          ≈ ${fiatAmount}
        </span>
      )}
      {isLoading && (
        <span className="text-xs text-outline">...</span>
      )}
      {error && (
        <span className="text-xs text-error" title={error}>
          ≈ ?
        </span>
      )}
    </span>
  );
}