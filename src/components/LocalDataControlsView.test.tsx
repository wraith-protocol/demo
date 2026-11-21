/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResetSummary, TransactionBlocker } from '@/lib/localData';
import {
  LocalDataControlsView,
  type LocalDataControlsViewProps,
  type LocalDataPendingAction,
} from './LocalDataControlsView';

const WALLET = `G${'A'.repeat(55)}`;
const SCOPE = { chain: 'stellar', network: 'testnet', wallet: WALLET };
const SIGNED: TransactionBlocker = {
  id: 'offline:1',
  category: 'offline-intents',
  kind: 'signed',
  summary: 'Signed transaction abc is queued and has not been broadcast.',
};
const SUMMARY: ResetSummary = {
  wallets: [
    { scope: SCOPE, categories: [{ id: 'labels', label: 'Stealth address labels', itemCount: 2 }] },
  ],
  device: [{ id: 'contacts', label: 'Contacts', itemCount: 3 }],
  caches: [{ name: 'wraith-rpc-v2', entries: 4 }],
  kept: ['wraith-precache-v2: app code, fonts and images only (keeps the app working offline)'],
  blockers: [SIGNED],
  totalItems: 9,
};

afterEach(cleanup);

/** Renders the view with the resolution/confirmation state wired like the container. */
function Harness({
  pending,
  onConfirm,
}: {
  pending: LocalDataPendingAction;
  onConfirm: () => void;
}) {
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState('');
  const props: LocalDataControlsViewProps = {
    status: 'ready',
    wallets: [],
    selectedWalletKey: null,
    selectedWalletCategories: new Set(),
    device: [],
    selectedDeviceCategories: new Set(),
    pending,
    resolvedBlockerIds: resolved,
    confirmation,
    busy: false,
    message: null,
    onSelectWallet: vi.fn(),
    onToggleWalletCategory: vi.fn(),
    onToggleDeviceCategory: vi.fn(),
    onExportWallet: vi.fn(),
    onExportDevice: vi.fn(),
    onRequestDeleteWallet: vi.fn(),
    onRequestReset: vi.fn(),
    onToggleResolved: (id) =>
      setResolved((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    onConfirmationChange: setConfirmation,
    onConfirm,
    onCancel: vi.fn(),
  };
  return (
    <MemoryRouter>
      <LocalDataControlsView {...props} />
    </MemoryRouter>
  );
}

describe('LocalDataControlsView', () => {
  it('holds a wallet deletion until each open transaction is explicitly resolved', () => {
    const onConfirm = vi.fn();
    render(
      <Harness
        pending={{ kind: 'delete-wallet', scope: SCOPE, itemCount: 4, blockers: [SIGNED] }}
        onConfirm={onConfirm}
      />,
    );

    const confirm = screen.getByRole<HTMLButtonElement>('button', { name: 'Delete' });
    expect(confirm.disabled).toBe(true);
    expect(screen.getByText(/Other wallets, networks and device-wide data/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText(/Signed transaction abc/));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('shows the precise reset summary and requires the typed confirmation', () => {
    const onConfirm = vi.fn();
    render(<Harness pending={{ kind: 'reset', summary: SUMMARY }} onConfirm={onConfirm} />);

    const dialog = screen.getByRole('dialog', { name: 'Confirm full local reset' });
    expect(dialog.textContent).toContain('removes 9 items');
    expect(dialog.textContent).toContain('stellar · testnet · GAAAAA…AAAAAA');
    expect(dialog.textContent).toContain('Stealth address labels: 2');
    expect(dialog.textContent).toContain('Contacts: 3');
    expect(dialog.textContent).toContain('wraith-rpc-v2: 4 cached responses');
    expect(dialog.textContent).toContain('wraith-precache-v2');

    const confirm = screen.getByRole<HTMLButtonElement>('button', { name: 'Reset everything' });
    fireEvent.change(screen.getByLabelText(/Type RESET to confirm/), {
      target: { value: 'reset' },
    });
    fireEvent.click(screen.getByLabelText(/Signed transaction abc/));
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Type RESET to confirm/), {
      target: { value: 'RESET' },
    });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
