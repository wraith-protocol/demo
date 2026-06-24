import { createContext, useContext, useState, useCallback } from 'react';

export interface ScannedAddress {
  address: string;
  chain: string;
  balance: string;
  scannedAt: number; // ms timestamp
}

interface ActivityContextValue {
  addresses: ScannedAddress[];
  upsert: (entry: ScannedAddress) => void;
}

const ActivityContext = createContext<ActivityContextValue | null>(null);

export function ActivityProvider({ children }: { children: React.ReactNode }) {
  const [addresses, setAddresses] = useState<ScannedAddress[]>([]);

  const upsert = useCallback((entry: ScannedAddress) => {
    setAddresses((prev) => {
      const idx = prev.findIndex((a) => a.address === entry.address);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = entry;
        return updated;
      }
      return [...prev, entry];
    });
  }, []);

  return (
    <ActivityContext.Provider value={{ addresses, upsert }}>{children}</ActivityContext.Provider>
  );
}

export function useActivity() {
  const ctx = useContext(ActivityContext);
  if (!ctx) throw new Error('useActivity must be used within ActivityProvider');
  return ctx;
}
