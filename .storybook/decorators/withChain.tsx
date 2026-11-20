import { useState } from 'react';
import type { Decorator } from '@storybook/react';
import { ChainContext, type Chain } from '@/context/ChainContext';

/**
 * Provides a fake ChainContext so components that call `useChain()` render in
 * isolation. The active chain is stateful, so the ChainSwitcher dropdown stays
 * interactive inside a story.
 */
export function withChain(initialChain: Chain = 'horizen'): Decorator {
  return function ChainDecorator(Story) {
    const [chain, setChain] = useState<Chain>(initialChain);
    return (
      <ChainContext.Provider value={{ chain, setChain }}>
        <Story />
      </ChainContext.Provider>
    );
  };
}
