import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface NameHistoryEntry {
  address: string;
  name?: string;
  lastUsed: number;
}

interface NameHistoryContextValue {
  history: NameHistoryEntry[];
  addToHistory: (address: string, name?: string) => void;
  isKnownRecipient: (address: string) => boolean;
}

const NameHistoryContext = createContext<NameHistoryContextValue | null>(null);

const STORAGE_KEY = 'wraith-name-history';

export function NameHistoryProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<NameHistoryEntry[]>([]);

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setHistory(JSON.parse(stored));
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Save history to localStorage when it changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  }, [history]);

  const addToHistory = (address: string, name?: string) => {
    setHistory((prev) => {
      // Remove existing entry with same address if exists
      const filtered = prev.filter((h) => h.address !== address);
      return [...filtered, { address, name, lastUsed: Date.now() }];
    });
  };

  const isKnownRecipient = (address: string) => {
    return history.some((h) => h.address === address);
  };

  return (
    <NameHistoryContext.Provider value={{ history, addToHistory, isKnownRecipient }}>
      {children}
    </NameHistoryContext.Provider>
  );
}

export function useNameHistory() {
  const ctx = useContext(NameHistoryContext);
  if (!ctx) throw new Error('useNameHistory must be used within NameHistoryProvider');
  return ctx;
}
