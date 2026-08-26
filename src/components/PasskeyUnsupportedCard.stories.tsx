import type { Meta, StoryObj } from '@storybook/react';
import { PasskeyUnsupportedCard } from './PasskeyUnsupportedCard';

const meta = {
  title: 'Stellar/PasskeyUnsupportedCard',
  component: PasskeyUnsupportedCard,
  args: { installUrl: 'https://passkeys.dev/device-support/' },
} satisfies Meta<typeof PasskeyUnsupportedCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
