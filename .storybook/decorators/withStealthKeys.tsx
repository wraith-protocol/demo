import type { ContextType } from 'react';
import type { Decorator } from '@storybook/react';
import { StealthKeysContext } from '@/context/StealthKeysContext';

type StealthKeysValue = NonNullable<ContextType<typeof StealthKeysContext>>;

const noop = () => {};

const baseValue: StealthKeysValue = {
  evmKeys: null,
  evmMetaAddress: null,
  stellarKeys: null,
  stellarMetaAddress: null,
  solanaKeys: null,
  solanaMetaAddress: null,
  ckbKeys: null,
  ckbMetaAddress: null,
  isRecoveryMode: false,
  isReadOnly: false,
  setIsRecoveryMode: noop,
  setIsReadOnly: noop,
  restoreFromRecoveryKit: noop,
  exitRecoveryMode: noop,
  setEvmKeys: noop,
  setEvmMetaAddress: noop,
  setStellarKeys: noop,
  setStellarMetaAddress: noop,
  setSolanaKeys: noop,
  setSolanaMetaAddress: noop,
  setCkbKeys: noop,
  setCkbMetaAddress: noop,
  clearEvm: noop,
  clearStellar: noop,
  clearSolana: noop,
  clearCkb: noop,
};

/**
 * Provides a fake StealthKeysContext. Pass overrides (e.g. `stellarKeys`,
 * `stellarMetaAddress`) to simulate a wallet that has already derived keys.
 * Setters default to no-ops so stories never mutate real state.
 */
export function withStealthKeys(overrides: Partial<StealthKeysValue> = {}): Decorator {
  return function StealthKeysDecorator(Story) {
    return (
      <StealthKeysContext.Provider value={{ ...baseValue, ...overrides }}>
        <Story />
      </StealthKeysContext.Provider>
    );
  };
}
