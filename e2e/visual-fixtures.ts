import { test as base } from '@playwright/test';

export const test = base.extend<{
  mockTime: Date;
  mockBalances: Record<string, string>;
  mockNetworkResponses: Record<string, any>;
}>({
  mockTime: async ({}, use) => {
    const fixedDate = new Date('2025-01-15T12:00:00.000Z');
    await use(fixedDate);
  },
  mockBalances: async ({}, use) => {
    const balances = {
      horizen: '1.5',
      stellar: '1000',
      solana: '50',
      ckb: '1000000',
    };
    await use(balances);
  },
  mockNetworkResponses: async ({}, use) => {
    const responses = {
      horizenNameResolve: {
        jsonrpc: '2.0',
        id: 1,
        result:
          '0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000041aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff0011223300000000000000000000000000000000000000000000000000000000000000',
      },
      horizenBalance: {
        jsonrpc: '2.0',
        id: 1,
        result: '0x152d02c7e14af6800000',
      },
      stellarBalance: '1000000000',
      solanaBalance: 50000000000,
      ckbBalance: 100000000000,
    };
    await use(responses);
  },
});

export const expect = base.expect;
