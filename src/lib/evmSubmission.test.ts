import { describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex, TransactionSerialized } from 'viem';
import {
  prepareEvmSend,
  submitVerifiedEvmTransaction,
  type EvmBroadcaster,
  type EvmFeeClient,
  type EvmSigner,
  type EvmSignRequest,
} from './evmSubmission';
import { IntentMismatchError } from './txIntent';

const SIGNER = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const OTHER_SIGNER = privateKeyToAccount(`0x${'33'.repeat(32)}`);
const TO = '0x2222222222222222222222222222222222222222' as const;
const DATA = '0xdeadbeef' as const;
const GAS = 90_000n;
const MAX_FEE = 2_000_000_000n;
const PRIORITY_FEE = 1_000_000_000n;
const NONCE = 7;

function feeClient(): EvmFeeClient {
  return {
    estimateGas: vi.fn().mockResolvedValue(GAS),
    estimateFeesPerGas: vi.fn().mockResolvedValue({
      maxFeePerGas: MAX_FEE,
      maxPriorityFeePerGas: PRIORITY_FEE,
    }),
    getTransactionCount: vi.fn().mockResolvedValue(NONCE),
  };
}

async function reviewedSend() {
  return prepareEvmSend(feeClient(), {
    chainId: 2651420,
    account: SIGNER.address,
    to: TO,
    data: DATA,
    value: 10n ** 17n,
    stealthAddress: '0x3333333333333333333333333333333333333333',
  });
}

function signWith(
  account: typeof SIGNER,
  request: EvmSignRequest,
  overrides: Record<string, unknown> = {},
): Promise<TransactionSerialized> {
  const { account: _account, ...transaction } = request;
  return account.signTransaction({
    ...transaction,
    ...overrides,
  }) as Promise<TransactionSerialized>;
}

function signerReturning(serialized: TransactionSerialized): EvmSigner {
  return { signTransaction: vi.fn().mockResolvedValue(serialized) };
}

function broadcaster() {
  return { sendRawTransaction: vi.fn().mockResolvedValue(`0x${'ab'.repeat(32)}` as Hex) };
}

describe('pre-broadcast EVM verification', () => {
  it('binds gas, fee caps and nonce into the reviewed intent', async () => {
    const { intent, request } = await reviewedSend();

    expect(request.gas).toBe(GAS);
    expect(request.maxFeePerGas).toBe(MAX_FEE);
    expect(request.maxPriorityFeePerGas).toBe(PRIORITY_FEE);
    expect(request.nonce).toBe(NONCE);
    expect(intent.fee).toContain(GAS.toString());
    expect(intent.extra.maxFeePerGas).toBe(MAX_FEE.toString());
    expect(intent.extra.maxPriorityFeePerGas).toBe(PRIORITY_FEE.toString());
    expect(intent.extra.nonce).toBe(String(NONCE));
  });

  it('broadcasts only the exact signed transaction that passed verification', async () => {
    const { intent, request } = await reviewedSend();
    const serialized = await signWith(SIGNER, request);
    const sendRawTransaction = broadcaster();

    const hash = await submitVerifiedEvmTransaction(
      signerReturning(serialized),
      sendRawTransaction as EvmBroadcaster,
      intent,
      request,
    );

    expect(hash).toBe(`0x${'ab'.repeat(32)}`);
    expect(sendRawTransaction.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(sendRawTransaction.sendRawTransaction).toHaveBeenCalledWith({
      serializedTransaction: serialized,
    });
  });

  it('submits nothing when the wallet signs a tampered transaction', async () => {
    const { intent, request } = await reviewedSend();
    const tampered = await signWith(SIGNER, request, { value: 1n });
    const sendRawTransaction = broadcaster();

    await expect(
      submitVerifiedEvmTransaction(
        signerReturning(tampered),
        sendRawTransaction as EvmBroadcaster,
        intent,
        request,
      ),
    ).rejects.toBeInstanceOf(IntentMismatchError);

    expect(sendRawTransaction.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('submits nothing when the wallet signs with a different account', async () => {
    const { intent, request } = await reviewedSend();
    const tampered = await signWith(OTHER_SIGNER, request);
    const sendRawTransaction = broadcaster();

    await expect(
      submitVerifiedEvmTransaction(
        signerReturning(tampered),
        sendRawTransaction as EvmBroadcaster,
        intent,
        request,
      ),
    ).rejects.toBeInstanceOf(IntentMismatchError);

    expect(sendRawTransaction.sendRawTransaction).not.toHaveBeenCalled();
  });

  it('submits nothing when verification is unavailable or the wallet result is unparseable', async () => {
    const { intent, request } = await reviewedSend();
    const sendRawTransaction = broadcaster();

    await expect(
      submitVerifiedEvmTransaction(
        undefined,
        sendRawTransaction as EvmBroadcaster,
        intent,
        request,
      ),
    ).rejects.toThrow(/verification is unavailable/i);

    await expect(
      submitVerifiedEvmTransaction(
        signerReturning('not-a-transaction' as TransactionSerialized),
        sendRawTransaction as EvmBroadcaster,
        intent,
        request,
      ),
    ).rejects.toBeInstanceOf(IntentMismatchError);

    expect(sendRawTransaction.sendRawTransaction).not.toHaveBeenCalled();
  });
});
