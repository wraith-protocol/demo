import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { reflectorOracle } from '@/lib/stellar/reflector';

export type FiatCurrency = 'USD' | 'EUR' | 'GBP' | 'NGN';

interface CurrencyConfig {
  code: FiatCurrency;
  symbol: string;
  name: string;
  supportedAssets: string[];
}

const CURRENCIES: Record<FiatCurrency, CurrencyConfig> = {
  USD: {
    code: 'USD',
    symbol: '$',
    name: 'USD',
    supportedAssets: ['XLM', 'USDC'],
  },
  EUR: {
    code: 'EUR',
    symbol: '€',
    name: 'Euro',
    supportedAssets: ['XLM', 'USDC'],
  },
  GBP: {
    code: 'GBP',
    symbol: '£',
    name: 'British Pound',
    supportedAssets: ['XLM', 'USDC'],
  },
  NGN: {
    code: 'NGN',
    symbol: '₦',
    name: 'Nigerian Naira',
    supportedAssets: ['XLM'],
  },
};

export function useFiatCurrency() {
  const [currency, setCurrency] = useState<FiatCurrency>('USD');
  const [isSupported, setIsSupported] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('fiat-currency');
    if (saved && saved in CURRENCIES) {
      setCurrency(saved as FiatCurrency);
    }

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'fiat-currency' && e.newValue && e.newValue in CURRENCIES) {
        setCurrency(e.newValue as FiatCurrency);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const updateCurrency = (newCurrency: FiatCurrency) => {
    if (newCurrency in CURRENCIES) {
      localStorage.setItem('fiat-currency', newCurrency);
      setCurrency(newCurrency);
    }
  };

  const getCurrencyConfig = (): CurrencyConfig => {
    const config = CURRENCIES[currency];
    if (!config) {
      setIsSupported(false);
      return {
        code: 'USD',
        symbol: '$',
        name: 'USD',
        supportedAssets: [],
      };
    }
    return config;
  };

  return { currency, updateCurrency, getCurrencyConfig, isSupported };
}

export function Settings() {
  const { t } = useTranslation();
  const { currency, updateCurrency, getCurrencyConfig, isSupported } = useFiatCurrency();
  const config = getCurrencyConfig();

  const currencies = Object.values(CURRENCIES) as CurrencyConfig[];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-bold uppercase tracking-tight text-on-surface">
          {t('settings.title')}
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          {t('settings.description')}
        </p>
      </div>

      <div className="flex flex-col gap-4 border border-outline-variant bg-surface-container p-5">
        <div className="flex flex-col gap-2">
          <label className="font-mono text-[10px] uppercase tracking-widest text-outline">
            {t('settings.fiatCurrency')}
          </label>
          <select
            value={currency}
            onChange={(e) => updateCurrency(e.target.value as FiatCurrency)}
            className="h-12 w-full border border-outline-variant bg-surface px-4 font-mono text-sm text-primary placeholder:text-outline focus:border-primary"
          >
            {currencies.map((curr) => (
              <option key={curr.code} value={curr.code}>
                {curr.name} ({curr.code})
              </option>
            ))}
          </select>
          {!isSupported && (
            <p className="text-xs text-error">
              {t('settings.currencyNotSupported')}
            </p>
          )}
        </div>

        <div className="border-t border-outline-variant/30 pt-4">
          <h2 className="mb-3 font-heading text-sm font-semibold uppercase tracking-widest text-on-surface">
            {t('settings.about')}
          </h2>
          <p className="font-body text-xs leading-relaxed text-on-surface-variant">
            {t('settings.aboutDescription')}
          </p>
        </div>
      </div>
    </div>
  );
}