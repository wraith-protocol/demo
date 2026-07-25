import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { StellarMatchCard } from './StellarMatchCard';
import { makeMatch, SAMPLE_TX_HASH, SAMPLE_STEALTH_ADDRESS } from '../../.storybook/fixtures';

const meta = {
  title: 'Stellar/StellarMatchCard',
  component: StellarMatchCard,
  args: {
    ...makeMatch(0),
    onDestChange: fn(),
    onWithdrawAssetKeyChange: fn(),
    onWithdraw: fn(),
    onSponsoredWithdraw: fn(),
    onCancelSponsor: fn(),
    onRevealKey: fn(),
  },
} satisfies Meta<typeof StellarMatchCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BalanceLoading: Story = {
  args: { balanceState: 'loading', balances: {} },
};

export const Funded: Story = {};

export const Empty: Story = {
  args: { balances: { XLM: '0' } },
};

export const BalanceError: Story = {
  args: { balanceState: 'error', balances: {} },
};

export const Withdrawing: Story = {
  args: { dest: SAMPLE_STEALTH_ADDRESS, withdrawing: true },
};

export const Withdrawn: Story = {
  args: { withdrawHash: SAMPLE_TX_HASH },
};

export const RevealedKey: Story = {
  args: { showKey: true },
};

export const WithdrawError: Story = {
  args: { dest: SAMPLE_STEALTH_ADDRESS, error: 'No XLM balance' },
};

export const SponsorPrompt: Story = {
  args: { balances: { XLM: '0.5' }, dest: SAMPLE_STEALTH_ADDRESS, showSponsorPrompt: true },
};

export const SponsoredWithdrawing: Story = {
  args: { dest: SAMPLE_STEALTH_ADDRESS, showSponsorPrompt: true, withdrawing: true },
};

export const SponsoredWithdrawn: Story = {
  args: { withdrawHash: SAMPLE_TX_HASH, feeBumpHash: SAMPLE_TX_HASH },
};
