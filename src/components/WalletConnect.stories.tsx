import type { Meta, StoryObj } from '@storybook/react';
import { WalletConnect } from './WalletConnect';
import { withChain } from '../../.storybook/decorators/withChain';
import { withStellarWallet } from '../../.storybook/decorators/withStellarWallet';
import { SAMPLE_STEALTH_ADDRESS } from '../../.storybook/fixtures';

/**
 * The real WalletConnect container, pinned to the Stellar chain so it renders
 * the Freighter button. Demonstrates withChain + withStellarWallet driving a
 * live consumer with no real wallet.
 */
const meta = {
  title: 'Stellar/WalletConnect (container)',
  component: WalletConnect,
  decorators: [withChain('stellar')],
} satisfies Meta<typeof WalletConnect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Disconnected: Story = {
  decorators: [withStellarWallet({ address: null })],
};

export const Connected: Story = {
  decorators: [withStellarWallet({ address: SAMPLE_STEALTH_ADDRESS })],
};
