import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Account,
  Address,
  nativeToScVal,
  Operation,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import {
  bytesToHex,
  deriveStealthKeys,
  generateStealthAddress,
} from '@wraith-protocol/sdk/chains/stellar';
import {
  deriveVaultClaimSigner,
  deriveVaultState,
  getVaultActions,
  loadVaultDeposits,
  submitVaultAction,
  type OnChainVaultDeposit,
} from './vaultStatus';

const SENDER = 'GSENDER';
const RECIPIENT = 'GRECIPIENT';
const VALID_SENDER = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';
const CONTRACT = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';

function deposit(state: OnChainVaultDeposit['state']): OnChainVaultDeposit {
  return {
    id: 'ab'.repeat(32),
    sender: SENDER,
    recipient: RECIPIENT,
    ephemeralPubKey: '00'.repeat(32),
    amount: '10',
    asset: 'CXLM',
    unlockLedger: 200,
    refundAfter: 300,
    createdLedger: 100,
    txHash: 'hash',
    state,
  };
}

describe('vault state transitions', () => {
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

  it.each([
    [199, undefined, false, 'pending'],
    [200, undefined, false, 'claimable'],
    [299, undefined, false, 'claimable'],
    [300, undefined, false, 'expired'],
    [250, 'claimed', false, 'claimed'],
    [350, 'refunded', false, 'refunded'],
    [250, undefined, true, 'failed'],
  ] as const)('derives ledger %s as %s', (ledger, terminal, readFailed, expected) => {
    expect(deriveVaultState(ledger, 200, 300, terminal, readFailed)).toBe(expected);
  });

  it('only allows a matched stealth key to claim during the claim window', () => {
    const keys = deriveStealthKeys(new Uint8Array(64).fill(7));
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);
    const claimable = {
      ...deposit('claimable'),
      recipient: stealth.stealthAddress,
      ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
    };

    expect(deriveVaultClaimSigner(claimable, keys)).toMatchObject({
      address: stealth.stealthAddress,
    });
    expect(getVaultActions(claimable, SENDER, keys)).toEqual({
      canClaim: true,
      canRefund: false,
    });
    expect(getVaultActions(claimable, SENDER, null).canClaim).toBe(false);
    expect(
      getVaultActions(claimable, SENDER, deriveStealthKeys(new Uint8Array(64).fill(8))).canClaim,
    ).toBe(false);
  });

  it('only allows the sender to refund after expiry', () => {
    expect(getVaultActions(deposit('expired'), SENDER)).toEqual({
      canClaim: false,
      canRefund: true,
    });
    expect(getVaultActions(deposit('expired'), RECIPIENT).canRefund).toBe(false);
  });

  it('never exposes actions for terminal or failed deposits', () => {
    for (const state of ['claimed', 'refunded', 'failed'] as const) {
      expect(getVaultActions(deposit(state), SENDER)).toEqual({
        canClaim: false,
        canRefund: false,
      });
    }
  });

  it('loads a persisted active deposit when its event is outside the retained window', async () => {
    const depositId = 'ab'.repeat(32);
    const ephemeralPubKey = '11'.repeat(32);
    localStorage.setItem(
      `wraith:stellar-vault-deposits:v1:${VALID_SENDER}`,
      JSON.stringify([
        {
          depositId,
          txHash: 'persisted-tx',
          sender: VALID_SENDER,
          recipient: VALID_SENDER,
          ephemeralPubKey,
          metaAddress: 'st:xlm:test',
          amount: '10',
          unlockLedger: 40_000,
          refundAfter: 60_000,
          createdAt: 1,
        },
      ]),
    );
    const getEvents = vi.fn(async () => ({ events: [] }));
    window.sorobanServerMock = {
      getLatestLedger: vi.fn(async () => ({ sequence: 50_000 })),
      getEvents,
      simulateTransaction: vi.fn(async () => ({
        result: {
          retval: xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol('sender'),
              val: new Address(VALID_SENDER).toScVal(),
            }),
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol('recipient'),
              val: new Address(VALID_SENDER).toScVal(),
            }),
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol('ephemeral_pub_key'),
              val: xdr.ScVal.scvBytes(Buffer.from(ephemeralPubKey, 'hex')),
            }),
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol('amount'),
              val: nativeToScVal(100_000_000n, { type: 'i128' }),
            }),
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol('asset'),
              val: new Address(CONTRACT).toScVal(),
            }),
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol('unlock_ledger'),
              val: nativeToScVal(40_000, { type: 'u32' }),
            }),
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol('refund_after'),
              val: nativeToScVal(60_000, { type: 'u32' }),
            }),
          ]),
        },
      })),
    };

    const result = await loadVaultDeposits(VALID_SENDER);

    expect(getEvents).toHaveBeenCalledWith(expect.objectContaining({ startLedger: 32_720 }));
    expect(result.deposits).toHaveLength(1);
    expect(result.deposits[0]).toMatchObject({
      id: depositId,
      txHash: 'persisted-tx',
      ephemeralPubKey,
      state: 'claimable',
    });
  });

  it('signs claim authorization with the matched stealth key before wallet signing', async () => {
    const keys = deriveStealthKeys(new Uint8Array(64).fill(7));
    const stealth = generateStealthAddress(keys.spendingPubKey, keys.viewingPubKey);
    const claimable = {
      ...deposit('claimable'),
      recipient: stealth.stealthAddress,
      ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
    };
    const claimSigner = deriveVaultClaimSigner(claimable, keys);
    expect(claimSigner).not.toBeNull();

    const invocation = new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(CONTRACT).toScAddress(),
          functionName: 'claim',
          args: [],
        }),
      ),
      subInvocations: [],
    });
    const authEntry = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({
          address: new Address(stealth.stealthAddress).toScAddress(),
          nonce: xdr.Int64.fromString('1'),
          signatureExpirationLedger: 0,
          signature: xdr.ScVal.scvVoid(),
        }),
      ),
      rootInvocation: invocation,
    });
    const sendTransaction = vi.fn(
      async (_transaction: ReturnType<TransactionBuilder['build']>) => ({
        status: 'PENDING',
        hash: 'claim-hash',
      }),
    );
    window.sorobanServerMock = {
      getAccount: vi.fn(async () => new Account(VALID_SENDER, '1')),
      getLatestLedger: vi.fn(async () => ({ sequence: 50_000 })),
      simulateTransaction: vi.fn(async () => ({ minResourceFee: '250', result: {} })),
      assembleTransaction: vi.fn((transaction: ReturnType<TransactionBuilder['build']>) => {
        const operation = transaction.operations[0];
        if (operation.type !== 'invokeHostFunction') throw new Error('Unexpected operation');
        return TransactionBuilder.cloneFrom(transaction)
          .clearOperations()
          .addOperation(
            Operation.invokeHostFunction({
              func: operation.func,
              auth: [authEntry],
            }),
          );
      }),
      sendTransaction,
      pollTransaction: vi.fn(async () => ({ status: 'SUCCESS' })),
    };
    const signTransaction = vi.fn(async (transactionXdr: string) => transactionXdr);

    await expect(
      submitVaultAction({
        action: 'claim',
        depositId: claimable.id,
        actor: VALID_SENDER,
        claimSigner: claimSigner!,
        signTransaction,
      }),
    ).resolves.toBe('claim-hash');

    expect(signTransaction).toHaveBeenCalledOnce();
    const submitted = sendTransaction.mock.calls[0][0];
    const submittedOperation = submitted.operations[0];
    expect(submittedOperation.type).toBe('invokeHostFunction');
    if (submittedOperation.type !== 'invokeHostFunction') return;
    const credentials = submittedOperation.auth?.[0].credentials().address();
    expect(credentials?.signatureExpirationLedger()).toBe(50_100);
    expect(credentials?.signature().switch().name).toBe('scvVec');
  });
});
