import { useState } from 'react';
import { useUndoStore } from '@/stores/undoStore';

interface Contact {
  id: string;
  name: string;
  address: string;
}

const INITIAL_CONTACTS: Contact[] = [
  { id: '1', name: 'Alice', address: 'GBVR...XYZW' },
  { id: '2', name: 'Bob', address: 'GCBA...MNOP' },
  { id: '3', name: 'Carol', address: 'GDZT...QRST' },
];

export default function Contacts() {
  const [contacts, setContacts] = useState<Contact[]>(INITIAL_CONTACTS);
  const addToast = useUndoStore((s) => s.addToast);

  const deleteContact = (contact: Contact) => {
    const previous = [...contacts];
    setContacts((c) => c.filter((x) => x.id !== contact.id));
    addToast(`Deleted "${contact.name}"`, () => {
      setContacts(previous);
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h1 className="font-heading text-[28px] font-bold uppercase tracking-tight text-on-surface">
          Contacts
        </h1>
        <p className="font-body text-sm leading-relaxed text-on-surface-variant">
          Manage your saved contacts.
        </p>
      </section>
      <ul className="flex flex-col gap-3">
        {contacts.length === 0 && (
          <p className="font-body text-sm text-on-surface-variant">No contacts yet.</p>
        )}
        {contacts.map((contact) => (
          <li
            key={contact.id}
            className="flex items-center justify-between rounded-xl bg-surface-variant px-4 py-3"
          >
            <div className="flex flex-col">
              <span className="font-body text-sm font-semibold text-on-surface">
                {contact.name}
              </span>
              <span className="font-mono text-xs text-on-surface-variant">{contact.address}</span>
            </div>
            <button
              onClick={() => deleteContact(contact)}
              className="font-body text-sm text-error hover:underline"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
