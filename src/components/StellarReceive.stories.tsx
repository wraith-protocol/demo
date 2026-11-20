import type { Meta, StoryObj } from '@storybook/react';
import { http, HttpResponse } from 'msw';
import { StellarReceive } from './StellarReceive';
import { withChain } from '../../.storybook/decorators/withChain';
import { withStellarWallet } from '../../.storybook/decorators/withStellarWallet';
import { withStealthKeys } from '../../.storybook/decorators/withStealthKeys';
import { SAMPLE_STEALTH_ADDRESS } from '../../.storybook/fixtures';

/**
 * The real StellarReceive container, wired through all three mocked contexts.
 * MSW stubs the Soroban/Horizon endpoints the container hits on mount, so the
 * story renders without any real network request.
 */
const meta = {
  title: 'Stellar/StellarReceive (container)',
  component: StellarReceive,
  decorators: [withChain('stellar'), withStealthKeys()],
  parameters: {
    msw: {
      handlers: [
        http.post('https://soroban-testnet.stellar.org', () =>
          HttpResponse.json({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'mocked' } }),
        ),
        http.get('https://horizon-testnet.stellar.org/accounts/*', () =>
          HttpResponse.json({ balances: [] }, { status: 404 }),
        ),
      ],
    },
  },
} satisfies Meta<typeof StellarReceive>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Disconnected: Story = {
  decorators: [withStellarWallet({ address: null })],
};

export const ConnectedNoKeys: Story = {
  decorators: [withStellarWallet({ address: SAMPLE_STEALTH_ADDRESS })],
};
