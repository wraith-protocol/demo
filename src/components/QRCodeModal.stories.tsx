import type { Meta, StoryObj } from '@storybook/react';
import { fn, within, userEvent, expect } from '@storybook/test';
import { useState, useRef } from 'react';
import { QRCodeModal } from './QRCodeModal';
import { SAMPLE_META_ADDRESS } from '../../.storybook/fixtures';

const meta = {
  title: 'A11y/QRCodeModal',
  component: QRCodeModal,
  parameters: { layout: 'fullscreen' },
  args: {
    value: SAMPLE_META_ADDRESS,
    onClose: fn(),
  },
} satisfies Meta<typeof QRCodeModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Modal open with a single QR variant — the default state tested for a11y. */
export const Open: Story = {};

/** Modal with two variants (meta-address + Stellar URI toggle). */
export const WithVariants: Story = {
  args: {
    title: 'Stealth Meta-Address',
    variants: [
      { label: 'Meta-address', value: SAMPLE_META_ADDRESS },
      { label: 'Stellar URI', value: `web+stellar:pay?destination=${SAMPLE_META_ADDRESS}` },
    ],
  },
};

/** Escape key should call onClose. */
export const EscapeCloses: Story = {
  play: async ({ canvasElement, args }) => {
    // The modal is rendered — press Escape and verify onClose was called.
    canvasElement.ownerDocument.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await expect(args.onClose).toHaveBeenCalled();
  },
};

/** Close button should call onClose. */
export const CloseButton: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /close modal/i }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};

/**
 * Interactive wrapper with trigger button for accessibility testing.
 * This story provides a real trigger button that can be focused before opening,
 * and the modal actually dismisses when closed via button or Escape.
 */
export const Interactive: Story = {
  render: (args) => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);

    return (
      <div className="flex h-screen items-center justify-center bg-surface">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          className="h-11 border border-outline-variant bg-surface-bright px-4 font-heading text-[11px] font-semibold uppercase tracking-widest text-primary transition-colors hover:bg-surface-container"
        >
          Show QR
        </button>
        {open && <QRCodeModal {...args} onClose={() => setOpen(false)} />}
      </div>
    );
  },
};
