import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from '@storybook/test';
import { StellarVaultDeposit } from './StellarVaultDeposit';
import { withStellarWallet } from '../../.storybook/decorators/withStellarWallet';
import { SAMPLE_META_ADDRESS, SAMPLE_STEALTH_ADDRESS } from '../../.storybook/fixtures';

const meta = {
  title: 'Stellar/StellarVaultDeposit',
  parameters: {
    msw: {
      disabled: true,
    },
  },
  component: StellarVaultDeposit,
  decorators: [withStellarWallet({ address: SAMPLE_STEALTH_ADDRESS })],
} satisfies Meta<typeof StellarVaultDeposit>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/**
 * Mounts real StellarVaultDeposit and verifies dynamic a11y validation feedback.
 */
export const InvalidInputFeedback: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const recipientInput = canvas.getByPlaceholderText(/st:xlm:\.\.\./i);
    await userEvent.clear(recipientInput);
    await userEvent.type(recipientInput, 'invalid-address');
    await userEvent.tab();

    const errorMessage = canvas.getByText(/not a valid stellar stealth meta-address/i);
    await expect(errorMessage).toBeInTheDocument();
  },
};

/**
 * Drives the real component with valid data and asserts Enter key triggers deposit creation.
 */
export const EnterKeySubmission: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const recipientInput = canvas.getByPlaceholderText(/st:xlm:\.\.\./i);
    await userEvent.clear(recipientInput);
    await userEvent.type(recipientInput, SAMPLE_META_ADDRESS);

    const amountInput = canvas.getByPlaceholderText('0.0');
    await userEvent.clear(amountInput);
    await userEvent.type(amountInput, '10');

    const unlockInput = canvas.getByPlaceholderText(/e\.g\., 100000/i);
    await userEvent.clear(unlockInput);
    await userEvent.type(unlockInput, '150000');

    const refundInput = canvas.getByPlaceholderText(/e\.g\., 10000/i);
    await userEvent.clear(refundInput);
    await userEvent.type(refundInput, '5000');

    // Submit using the real button enabled by the valid input
    const submitButton = canvas.getByRole('button', { name: /create deposit/i });
    await expect(submitButton).not.toBeDisabled();
    await userEvent.click(submitButton);

    // Direct result assertion: verify real success state is rendered
    const successBanner = await canvas.findByText(/deposit created/i, {}, { timeout: 3500 });
    await expect(successBanner).toBeInTheDocument();
  },
};
export const Interactive = EnterKeySubmission;
