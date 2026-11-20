import type { Meta, StoryObj } from '@storybook/react';
import { fn, expect } from '@storybook/test';
import { StellarBatchWithdrawModal } from './StellarBatchWithdrawModal';
import { withStellarWallet } from '../../.storybook/decorators/withStellarWallet';
import { SAMPLE_STEALTH_ADDRESS } from '../../.storybook/fixtures';
import type { MatchedAnnouncement } from '@wraith-protocol/sdk/chains/stellar';

// ---------------------------------------------------------------------------
// Static fixture data — no wallet or chain context needed
// ---------------------------------------------------------------------------

const STEALTH_ADDRESSES = [
  'GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX',
  'GCKFBEIYTKP6RCZX6YQX3FNGPXY7QHFB7TQVUMHDLPZ6KUVCZNFP7B4S',
  'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
];

function makeMatch(stealthAddress: string): MatchedAnnouncement {
  return {
    schemeId: 1,
    stealthAddress,
    caller: SAMPLE_STEALTH_ADDRESS,
    ephemeralPubKey: 'a'.repeat(64),
    metadata: '01' + 'b'.repeat(62),
    stealthPrivateScalar: 123456789n,
    stealthPubKeyBytes: new Uint8Array(32).fill(1),
  };
}

const SAMPLE_MATCHES = STEALTH_ADDRESSES.map(makeMatch);

const SAMPLE_BALANCES: Record<string, string> = {
  [STEALTH_ADDRESSES[0]]: '5.5000000',
  [STEALTH_ADDRESSES[1]]: '12.0000000',
  [STEALTH_ADDRESSES[2]]: '3.2500000',
};

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta = {
  title: 'A11y/StellarBatchWithdrawModal',
  component: StellarBatchWithdrawModal,
  parameters: { layout: 'fullscreen' },
  decorators: [withStellarWallet({ address: SAMPLE_STEALTH_ADDRESS })],
  args: {
    isOpen: true,
    onClose: fn(),
    onBatchSuccess: fn(),
    selectedMatches: SAMPLE_MATCHES,
    knownBalances: SAMPLE_BALANCES,
  },
} satisfies Meta<typeof StellarBatchWithdrawModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Modal open in preview state — the default a11y target. */
export const Open: Story = {};

/** Escape key should call onClose (since not submitting). */
export const EscapeCloses: Story = {
  play: async ({ canvasElement, args }) => {
    canvasElement.ownerDocument.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await expect(args.onClose).toHaveBeenCalled();
  },
};

/** Modal with zero selected matches (valid edge-case for axe). */
export const Empty: Story = {
  args: {
    selectedMatches: [],
    knownBalances: {},
  },
};

/** Modal closed — component should render nothing. */
export const Closed: Story = {
  args: { isOpen: false },
};
