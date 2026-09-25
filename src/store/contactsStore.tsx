import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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

  // Load contacts from localStorage on mount
  useEffect(() => {
    try {
      setContacts(readVersionedCollection(localStorage, STORAGE_KEY, isContact));
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Save contacts to localStorage when they change
  useEffect(() => {
    writeVersioned(localStorage, STORAGE_KEY, contacts);
  }, [contacts]);

  const addContact = (address: string, name: string) => {
    setContacts((prev) => {
      // Remove existing contact with same address if exists
      const filtered = prev.filter((c) => c.address !== address);
      return [...filtered, { address, name, addedAt: Date.now() }];
    });
  };

  const removeContact = (address: string) => {
    setContacts((prev) => prev.filter((c) => c.address !== address));
  };

  const isKnownAddress = (address: string) => {
    return contacts.some((c) => c.address === address);
  };

  const getContactName = (address: string) => {
    return contacts.find((c) => c.address === address)?.name;
  };

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
