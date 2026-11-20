import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect } from '@storybook/test';
import { CopyButton } from './CopyButton';

const meta = {
  title: 'Stellar/CopyButton',
  component: CopyButton,
  args: { text: 'GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX' },
} satisfies Meta<typeof CopyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};

export const Copied: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /copy/i }));
    await expect(canvas.getByRole('button', { name: /copied/i })).toBeInTheDocument();
  },
};
