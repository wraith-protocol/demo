import type { Meta, StoryObj } from '@storybook/react';
import { ChainSwitcher } from './ChainSwitcher';
import { withChain } from '../../.storybook/decorators/withChain';

const meta = {
  title: 'Stellar/ChainSwitcher',
  component: ChainSwitcher,
  decorators: [withChain('stellar')],
} satisfies Meta<typeof ChainSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizen: Story = { decorators: [withChain('horizen')] };
export const Stellar: Story = { decorators: [withChain('stellar')] };
export const Solana: Story = { decorators: [withChain('solana')] };
export const Ckb: Story = { decorators: [withChain('ckb')] };

export const DisabledStates: Story = {
  args: { disabledChains: ['solana', 'ckb'] },
};
