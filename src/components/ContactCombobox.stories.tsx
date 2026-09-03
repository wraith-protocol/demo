import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect } from '@storybook/test';
import { ContactCombobox, type ContactOption } from './ContactCombobox';

const SAMPLE_OPTIONS: ContactOption[] = [
  { address: 'st:xlm:AAAAPAYROLLONE', name: 'Alice (Payroll)' },
  { address: 'st:xlm:BBBBPAYROLLTWO', name: 'Bob (Contractor)' },
  { address: 'st:xlm:CCCCVENDORONE', name: 'Acme Vendor' },
];

function ControlledCombobox(props: Partial<Parameters<typeof ContactCombobox>[0]>) {
  const [value, setValue] = useState(props.value ?? '');
  return (
    <div className="w-72 bg-surface p-4">
      <ContactCombobox
        ariaLabel="Recipient meta-address"
        options={SAMPLE_OPTIONS}
        {...props}
        value={value}
        onChange={setValue}
      />
    </div>
  );
}

const meta = {
  title: 'Stellar/ContactCombobox',
  component: ControlledCombobox,
} satisfies Meta<typeof ControlledCombobox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const WithValue: Story = {
  args: { value: 'st:xlm:AAAAPAYROLLONE' },
};

export const Invalid: Story = {
  args: { value: 'not-a-meta-address', invalid: true },
};

export const SuggestionsOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('combobox');
    await userEvent.type(input, 'a');
    await expect(canvas.getByRole('listbox')).toBeInTheDocument();
  },
};