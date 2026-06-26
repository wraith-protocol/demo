import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { StellarSendView } from './StellarSendView';
import {
  SAMPLE_META_ADDRESS,
  SAMPLE_STEALTH_ADDRESS,
  SAMPLE_TX_HASH,
} from '../../.storybook/fixtures';

const meta = {
  title: 'Stellar/StellarSendView',
  component: StellarSendView,
  args: {
    isConnected: true,
    recipient: '',
    amount: '',
    recipientError: '',
    showRecipientError: false,
    amountError: '',
    showAmountError: false,
    amountInvalid: false,
    balanceText: 'Enter amount',
    balanceIsError: false,
    simulationStatus: 'idle',
    simulationError: '',
    simulationFee: null,
    simulationReturnValue: null,
    simulationEvents: [],
    error: '',
    canSubmit: false,
    isPending: false,
    stealthResult: null,
    txHash: null,
    isSuccess: false,
    onRecipientChange: fn(),
    onRecipientBlur: fn(),
    onAmountChange: fn(),
    onAmountBlur: fn(),
    onPaste: fn(),
    onSend: fn(),
    onReset: fn(),
  },
} satisfies Meta<typeof StellarSendView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Disconnected: Story = { args: { isConnected: false } };

export const Idle: Story = {};

export const Filled: Story = {
  args: {
    recipient: SAMPLE_META_ADDRESS,
    amount: '5',
    balanceText: '100 XLM',
    canSubmit: true,
  },
};

export const CheckingBalance: Story = {
  args: { recipient: SAMPLE_META_ADDRESS, amount: '5', balanceText: 'Checking...' },
};

export const InsufficientBalance: Story = {
  args: {
    recipient: SAMPLE_META_ADDRESS,
    amount: '5000',
    showAmountError: true,
    amountInvalid: true,
    balanceText: 'Insufficient XLM (you have 100, need 5001.00001)',
    balanceIsError: true,
  },
};

export const Pending: Story = {
  args: {
    recipient: SAMPLE_META_ADDRESS,
    amount: '5',
    balanceText: '100 XLM',
    canSubmit: false,
    isPending: true,
  },
};

export const RecipientError: Story = {
  args: {
    recipient: 'st:xlm:not-valid',
    showRecipientError: true,
    recipientError: 'Not a valid Stellar stealth meta-address',
  },
};

export const AmountError: Story = {
  args: {
    recipient: SAMPLE_META_ADDRESS,
    amount: '0',
    showAmountError: true,
    amountInvalid: true,
    amountError: 'Amount must be greater than 0.0000001 XLM',
  },
};

export const SubmitError: Story = {
  args: {
    recipient: SAMPLE_META_ADDRESS,
    amount: '5',
    balanceText: '100 XLM',
    error: 'Transaction failed',
  },
};

export const PendingResult: Story = {
  args: { stealthResult: { stealthAddress: SAMPLE_STEALTH_ADDRESS }, isSuccess: false },
};

export const Success: Story = {
  args: {
    stealthResult: { stealthAddress: SAMPLE_STEALTH_ADDRESS },
    txHash: SAMPLE_TX_HASH,
    isSuccess: true,
  },
};
