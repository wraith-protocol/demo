import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { StellarReceiveView } from './StellarReceiveView';
import { StellarMatchCard } from './StellarMatchCard';
import { SAMPLE_META_ADDRESS, SAMPLE_TX_HASH, makeMatches } from '../../.storybook/fixtures';

function renderMatches(n: number) {
  return makeMatches(n).map((m, i) => <StellarMatchCard key={i} {...m} />);
}

const meta = {
  title: 'Stellar/StellarReceiveView',
  component: StellarReceiveView,
  args: {
    isConnected: true,
    isDerivingKeys: false,
    keysDerived: true,
    metaAddress: SAMPLE_META_ADDRESS,
    registered: false,
    isRegistering: false,
    regHash: null,
    isScanning: false,
    hasScanned: false,
    matchCount: 0,
    matches: null,
    error: '',
    onDeriveKeys: fn(),
    onRegister: fn(),
    onScan: fn(),
  },
  argTypes: {
    matches: { control: false },
  },
} satisfies Meta<typeof StellarReceiveView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Disconnected: Story = { args: { isConnected: false } };

export const NoKeys: Story = { args: { keysDerived: false, metaAddress: null } };

export const Deriving: Story = {
  args: { keysDerived: false, metaAddress: null, isDerivingKeys: true },
};

export const DeriveError: Story = {
  args: { keysDerived: false, metaAddress: null, error: 'Key derivation failed' },
};

export const Unregistered: Story = {};

export const Registering: Story = { args: { isRegistering: true } };

export const Registered: Story = {
  args: { registered: true, regHash: SAMPLE_TX_HASH },
};

export const ScanInProgress: Story = {
  args: { registered: true, regHash: SAMPLE_TX_HASH, isScanning: true },
};

export const ScanError: Story = {
  args: { registered: true, regHash: SAMPLE_TX_HASH, error: 'Scan failed' },
};

export const NoMatches: Story = {
  args: { registered: true, regHash: SAMPLE_TX_HASH, hasScanned: true, matchCount: 0 },
};

export const OneMatch: Story = {
  args: {
    registered: true,
    regHash: SAMPLE_TX_HASH,
    hasScanned: true,
    matchCount: 1,
    matches: renderMatches(1),
  },
};

export const TenMatches: Story = {
  args: {
    registered: true,
    regHash: SAMPLE_TX_HASH,
    hasScanned: true,
    matchCount: 10,
    matches: renderMatches(10),
  },
};

export const FiftyMatches: Story = {
  args: {
    registered: true,
    regHash: SAMPLE_TX_HASH,
    hasScanned: true,
    matchCount: 50,
    matches: renderMatches(50),
  },
};
