import type { StellarMatchCardProps } from '@/components/StellarMatchCard';

/** A fake Stellar stealth meta-address (`st:xlm:` + 64-byte hex), for display only. */
export const SAMPLE_META_ADDRESS =
  'st:xlm:' +
  '3b9a4c2e8f1d6705a2c4e6981b3d5f70' +
  '9e2c4a6088d1f3b5d7092e4c6a8b0d2f' +
  '1a3c5e7088b0d2f406182a3c5e7088b0' +
  'd2f406182a4c6e8088a2c4e6088b0d2f';

/** A handful of fake but well-formed-looking Stellar account addresses (G…, 56 chars). */
const SAMPLE_STEALTH_ADDRESSES = [
  'GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX',
  'GCKFBEIYTKP6RCZX6YQX3FNGPXY7QHFB7TQVUMHDLPZ6KUVCZNFP7B4S',
  'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
  'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
  'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6',
];

/** A single fake Stellar stealth address (G…), for send/receive result stories. */
export const SAMPLE_STEALTH_ADDRESS = SAMPLE_STEALTH_ADDRESSES[0];

/** A fake 64-char hex stealth private scalar. */
export const SAMPLE_SCALAR_HEX = 'a3f1c94d7e2b80561fd0e9c4a8b62370d1559e4cab8f0273e6d419a5cf0b8d24';

/** A fake 64-char hex transaction hash. */
export const SAMPLE_TX_HASH = '7c1e4b2a9f0d3856e1c7a4b0d92f5e83a6c0419d7e2b8053fd0e9c4a8b623701';

function addressForIndex(i: number): string {
  if (i < SAMPLE_STEALTH_ADDRESSES.length) return SAMPLE_STEALTH_ADDRESSES[i];
  // Derive a deterministic, plausible-looking G… address for larger lists.
  const seed = SAMPLE_STEALTH_ADDRESSES[i % SAMPLE_STEALTH_ADDRESSES.length];
  const tail = (i * 7).toString(32).toUpperCase().replace(/[018]/g, 'A').padStart(3, '2');
  return seed.slice(0, 53) + tail.slice(-3);
}

/**
 * Builds a single `StellarMatchCard` prop set. Defaults to a loaded, funded
 * match; pass overrides to model loading / error / withdrawn states.
 */
export function makeMatch(
  i = 0,
  overrides: Partial<StellarMatchCardProps> = {},
): StellarMatchCardProps {
  return {
    stealthAddress: addressForIndex(i),
    scalarHex: SAMPLE_SCALAR_HEX,
    balance: (10 + i).toFixed(7),
    balanceState: 'loaded',
    dest: '',
    withdrawing: false,
    withdrawHash: null,
    feeBumpHash: null,
    error: '',
    showKey: false,
    showSponsorPrompt: false,
    onDestChange: () => {},
    onWithdraw: () => {},
    onSponsoredWithdraw: () => {},
    onCancelSponsor: () => {},
    onRevealKey: () => {},
    ...overrides,
  };
}

/** Builds `n` funded matches with varying addresses and balances. */
export function makeMatches(n: number): StellarMatchCardProps[] {
  return Array.from({ length: n }, (_, i) => makeMatch(i));
}
