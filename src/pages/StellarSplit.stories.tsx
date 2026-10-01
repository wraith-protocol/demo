import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from '@storybook/test';
import StellarSplit from './StellarSplit';
import { withStellarWallet } from '../../.storybook/decorators/withStellarWallet';
import { SAMPLE_STEALTH_ADDRESS } from '../../.storybook/fixtures';

const meta = {
  title: 'Pages/StellarSplit',
  parameters: {
    msw: {
      disabled: true,
    },
  },
  component: StellarSplit,
  decorators: [withStellarWallet({ address: SAMPLE_STEALTH_ADDRESS })],
} satisfies Meta<typeof StellarSplit>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ValidatedBatch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Locate the CSV textarea in the real component
    const textarea = canvas.getByRole('textbox', { name: /batch recipients csv/i });

    // Type valid CSV data
    const sampleCsv = `${SAMPLE_STEALTH_ADDRESS},10\n${SAMPLE_STEALTH_ADDRESS},5.5`;
    await userEvent.clear(textarea);
    await userEvent.type(textarea, sampleCsv);

    // Click the real Validate button
    const validateButton = canvas.getByRole('button', { name: /validate/i });
    await userEvent.click(validateButton);

    // Assert that the real component rendered the preview table and send button
    const table = await canvas.findByRole('table', { name: /batch recipients preview/i });
    await expect(table).toBeInTheDocument();

    const sendButton = await canvas.findByRole('button', { name: /send batch/i });
    await expect(sendButton).toBeInTheDocument();
  },
};

export const InvalidBatchError: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const textarea = canvas.getByRole('textbox', { name: /batch recipients csv/i });
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'invalid_address,not_a_number');

    const validateButton = canvas.getByRole('button', { name: /validate/i });
    await userEvent.click(validateButton);

    // Assert that the real component's validation alert triggers
    const alert = await canvas.findByRole('alert');
    await expect(alert).toBeInTheDocument();
  },
};

/**
 * Tests keyboard interaction: entering data and triggering validation via keyboard/Enter,
 * explicitly asserting the validated table result appears.
 */
export const EnterKeySubmission: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const textarea = canvas.getByRole('textbox', { name: /batch recipients csv/i });
    await userEvent.clear(textarea);
    await userEvent.type(textarea, `${SAMPLE_STEALTH_ADDRESS},10`);

    // Tab to the Validate button and press Enter to test keyboard activation
    const validateButton = canvas.getByRole('button', { name: /validate/i });
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');

    // Explicit result assertion: verify batch validation table renders successfully
    const table = await canvas.findByRole('table', { name: /batch recipients preview/i });
    await expect(table).toBeInTheDocument();

    const sendButton = await canvas.findByRole('button', { name: /send batch/i });
    await expect(sendButton).toBeInTheDocument();
  },
};
export const Interactive = EnterKeySubmission;
