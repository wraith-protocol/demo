import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { FreighterConnectButton } from './FreighterConnectButton';
import { SAMPLE_STEALTH_ADDRESS } from '../../.storybook/fixtures';

const meta = {
  title: 'Stellar/FreighterConnectButton',
  component: FreighterConnectButton,
  args: {
    status: 'disconnected',
    address: null,
    onConnect: fn(),
    onDisconnect: fn(),
  },
} satisfies Meta<typeof FreighterConnectButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Disconnected: Story = { args: { status: 'disconnected' } };

export const Connecting: Story = { args: { status: 'connecting' } };

export const Connected: Story = {
  args: { status: 'connected', address: SAMPLE_STEALTH_ADDRESS },
};

export const NetworkMismatch: Story = { args: { status: 'mismatch' } };
