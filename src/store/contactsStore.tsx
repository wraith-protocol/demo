import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  isBoundedString,
  isFiniteTimestamp,
  readVersionedCollection,
  writeVersioned,
} from '../lib/versionedStorage';

export interface Contact {
  address: string;
  name: string;
  addedAt: number;
}

interface ContactsContextValue {
  contacts: Contact[];
  addContact: (address: string, name: string) => void;
  removeContact: (address: string) => void;
  isKnownAddress: (address: string) => boolean;
  getContactName: (address: string) => string | undefined;
}

const ContactsContext = createContext<ContactsContextValue | null>(null);

const STORAGE_KEY = 'wraith-contacts';

function isContact(value: unknown): value is Contact {
  if (typeof value !== 'object' || value === null) return false;
  const contact = value as Record<string, unknown>;
  return (
    isBoundedString(contact.address, 512) &&
    contact.address.length > 0 &&
    isBoundedString(contact.name, 200) &&
    isFiniteTimestamp(contact.addedAt)
  );
}

export function ContactsProvider({ children }: { children: ReactNode }) {
  const [contacts, setContacts] = useState<Contact[]>([]);

  // Load contacts from localStorage on mount and sync across tabs
  useEffect(() => {
    const load = () => {
      try {
        // Use the new versioned reader
        setContacts(readVersionedCollection(localStorage, STORAGE_KEY, isContact));
      } catch {
        // Ignore parse errors
      }
    };

    load();

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        if (e.newValue) {
          try {
            // Read the latest state using the versioned reader
            const incoming = readVersionedCollection(localStorage, STORAGE_KEY, isContact);
            setContacts(incoming);
          } catch {
            // Ignore
          }
        } else {
          // Key was removed
          setContacts([]);
        }
      } else if (e.key === null) {
        // LocalStorage cleared
        setContacts([]);
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const addContact = useCallback((address: string, name: string) => {
    setContacts((prev: Contact[]) => {
      // Merge with latest from storage to avoid overwriting other tabs' additions
      let currentStore = prev;
      try {
        currentStore = readVersionedCollection(localStorage, STORAGE_KEY, isContact);
      } catch {}

      const filtered = currentStore.filter((c) => c.address !== address);
      const next = [...filtered, { address, name, addedAt: Date.now() }];

      // Use the new versioned writer
      writeVersioned(localStorage, STORAGE_KEY, next);

      return next;
    });
  }, []);

  const removeContact = useCallback((address: string) => {
    setContacts((prev: Contact[]) => {
      let currentStore = prev;
      try {
        currentStore = readVersionedCollection(localStorage, STORAGE_KEY, isContact);
      } catch {}

      const next = currentStore.filter((c) => c.address !== address);
      writeVersioned(localStorage, STORAGE_KEY, next);
      return next;
    });
  }, []);

  const isKnownAddress = useCallback(
    (address: string) => {
      return contacts.some((c: Contact) => c.address === address);
    },
    [contacts],
  );

  const getContactName = useCallback(
    (address: string) => {
      return contacts.find((c: Contact) => c.address === address)?.name;
    },
    [contacts],
  );

  return (
    <ContactsContext.Provider
      value={{ contacts, addContact, removeContact, isKnownAddress, getContactName }}
    >
      {children}
    </ContactsContext.Provider>
  );
}

export function useContacts() {
  const ctx = useContext(ContactsContext);
  if (!ctx) throw new Error('useContacts must be used within ContactsProvider');
  return ctx;
}
