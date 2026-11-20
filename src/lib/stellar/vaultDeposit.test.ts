import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Account, xdr } from '@stellar/stellar-sdk';
import { deriveStealthKeys, encodeStealthMetaAddress } from '@wraith-protocol/sdk/chains/stellar';
import { getVaultContractId, loadPersistedVaultDeposits, submitVaultDeposit } from './vaultDeposit';

const SENDER = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';
const CONTRACT = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
const DEPOSIT_ID = 'ab'.repeat(32);

function recipientMetaAddress() {
  const keys = deriveStealthKeys(new Uint8Array(64).fill(7));
  return encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
}

function installServer(overrides: Record<string, unknown> = {}) {
  const server = {
    getAccount: vi.fn(async () => new Account(SENDER, '1')),
    simulateTransaction: vi.fn(async () => ({ minResourceFee: '250', result: {} })),
    assembleTransaction: vi.fn((transaction: { toXDR(): string }) => ({
      build: () => transaction,
    })),
    sendTransaction: vi.fn(async () => ({ status: 'PENDING', hash: 'real-testnet-hash' })),
    pollTransaction: vi.fn(async () => ({
      status: 'SUCCESS',
      returnValue: xdr.ScVal.scvBytes(Buffer.from(DEPOSIT_ID, 'hex')),
    })),
    ...overrides,
  };
  window.sorobanServerMock = server;
  return server;
}

describe('submitVaultDeposit', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
    vi.stubGlobal('window', {
      __WRAITH_CONFIG__: { stellarVaultContractId: CONTRACT },
    });
  });

  it('submits and persists a confirmed Stellar Testnet deposit', async () => {
    const server = installServer();
    const progress: string[] = [];
    const signTransaction = vi.fn(async (transactionXdr: string) => transactionXdr);

    const deposit = await submitVaultDeposit({
      sender: SENDER,
      metaAddress: recipientMetaAddress(),
      amount: '10.5000000',
      unlockLedger: 500_000,
      refundWindow: 10_000,
      signTransaction,
      onProgress: (state) => progress.push(state.status),
    });

    expect(progress).toEqual(['simulating', 'signing', 'pending', 'success']);
    expect(signTransaction).toHaveBeenCalledOnce();
    expect(server.sendTransaction).toHaveBeenCalledOnce();
    expect(deposit).toMatchObject({ depositId: DEPOSIT_ID, txHash: 'real-testnet-hash' });
    expect(loadPersistedVaultDeposits(SENDER)).toEqual([deposit]);
  });

  it('stops before signing when the testnet contract rejects simulation', async () => {
    const server = installServer({
      simulateTransaction: vi.fn(async () => ({ error: 'Error(Contract, #3)' })),
    });
    const signTransaction = vi.fn(async (transactionXdr: string) => transactionXdr);

    await expect(
      submitVaultDeposit({
        sender: SENDER,
        metaAddress: recipientMetaAddress(),
        amount: '1',
        unlockLedger: 500_000,
        refundWindow: 10,
        signTransaction,
      }),
    ).rejects.toThrow('Vault contract rejected the deposit (error #3)');

    expect(signTransaction).not.toHaveBeenCalled();
    expect(server.sendTransaction).not.toHaveBeenCalled();
    expect(loadPersistedVaultDeposits(SENDER)).toEqual([]);
  });

  it('requires an explicit deployed contract configuration', async () => {
    window.__WRAITH_CONFIG__ = {};
    expect(getVaultContractId()).toBe('');

    await expect(
      submitVaultDeposit({
        sender: SENDER,
        metaAddress: recipientMetaAddress(),
        amount: '1',
        unlockLedger: 500_000,
        refundWindow: 10_000,
        signTransaction: vi.fn(),
      }),
    ).rejects.toThrow('Stealth vault contract is not configured');
  });
});
