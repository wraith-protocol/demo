import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type FiatCurrency = 'USD' | 'EUR' | 'GBP' | 'NGN';

interface SettingsContextValue {
  currency: FiatCurrency;
  updateCurrency: (currency: FiatCurrency) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrency] = useState<FiatCurrency>('USD');

  useEffect(() => {
    const saved = localStorage.getItem('fiat-currency');
    if (saved && ['USD', 'EUR', 'GBP', 'NGN'].includes(saved)) {
      setCurrency(saved as FiatCurrency);
    }
  }, []);

  const updateCurrency = (newCurrency: FiatCurrency) => {
    localStorage.setItem('fiat-currency', newCurrency);
    setCurrency(newCurrency);
    window.dispatchEvent(new Event('storage'));
  };

  return (
    <SettingsContext.Provider value={{ currency, updateCurrency }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}