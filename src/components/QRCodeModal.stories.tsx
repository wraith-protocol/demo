import type { Meta, StoryObj } from '@storybook/react';
import { fn, within, userEvent, expect } from '@storybook/test';
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
