import { describe, expect, it } from 'vitest';
import {
  Account,
  Asset,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  Keypair as SolanaKeypair,
  PublicKey,
  SystemProgram,
  Transaction as SolanaTransaction,
} from '@solana/web3.js';
import { privateKeyToAccount } from 'viem/accounts';
import type { TransactionSerialized } from 'viem';
import {
  bindSimulation,
  buildCkbSendIntent,
  buildEvmSendIntent,
  buildSolanaSendIntent,
  buildStellarSendIntent,
  canonicalizeIntent,
  describeIntent,
  diffIntents,
  fingerprintIntent,
  fingerprintWalletContext,
  simulationIsFresh,
  verifyCkbSignedTransaction,
  verifyEvmSignedTransaction,
  verifyEvmSubmittedTransaction,
  verifySolanaSignedTransaction,
  verifyStellarSignedTransaction,
  verifyStellarTransactionIntent,
  walletContextFromIntent,
} from '@/lib/txIntent';

const STELLAR_NETWORK = Networks.TESTNET;
const SENDER = 'GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX';
const STEALTH = Keypair.random().publicKey();
const OTHER_STEALTH = Keypair.random().publicKey();
const ANNOUNCER = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';

function stellarIntent(overrides: Partial<Parameters<typeof buildStellarSendIntent>[0]> = {}) {
  return buildStellarSendIntent({
    address: SENDER,
    metaAddress: 'st:xlm:test',
    stealthAddress: STEALTH,
    amount: '1',
    asset: 'XLM',
    memo: 'Coffee',
    sequence: '123',
    operation: 'payment',
    announcerContract: ANNOUNCER,
    schemeId: '1',
    ephemeralPubKey: 'aa'.repeat(32),
    viewTag: 7,
    networkPassphrase: STELLAR_NETWORK,
    ...overrides,
  });
}

function buildStellarTransaction(intent: ReturnType<typeof stellarIntent>) {
  return new TransactionBuilder(new Account(intent.account, intent.extra.sequence), {
    fee: intent.fee,
    networkPassphrase: STELLAR_NETWORK,
  })
    .addOperation(
      Operation.payment({
        destination: intent.recipient,
        asset: Asset.native(),
        amount: intent.amount,
      }),
    )
    .addMemo(Memo.text(intent.memo ?? ''))
    .setTimeout(30)
    .build();
}

function signStellar(transaction: ReturnType<typeof buildStellarTransaction>) {
  transaction.sign(Keypair.random());
  return transaction.toXDR();
}

const EVM_SIGNER = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const EVM_OTHER_SIGNER = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const EVM_TO = '0x2222222222222222222222222222222222222222' as const;
const EVM_STEALTH = '0x3333333333333333333333333333333333333333';
const EVM_DATA = '0xdeadbeef' as const;
const EVM_VALUE = 10n ** 17n;
const EVM_GAS = 90_000n;
const EVM_MAX_FEE = 2_000_000_000n;
const EVM_PRIORITY_FEE = 1_000_000_000n;
const EVM_NONCE = 7;

function evmIntent() {
  return buildEvmSendIntent({
    chainId: 2651420,
    account: EVM_SIGNER.address,
    to: EVM_TO,
    stealthAddress: EVM_STEALTH,
    data: EVM_DATA,
    value: EVM_VALUE,
    gas: EVM_GAS,
    maxFeePerGas: EVM_MAX_FEE,
    maxPriorityFeePerGas: EVM_PRIORITY_FEE,
    nonce: EVM_NONCE,
  });
}

function evmSignRequest(overrides: Record<string, unknown> = {}) {
  return {
    account: EVM_SIGNER.address,
    chainId: 2651420,
    to: EVM_TO,
    data: EVM_DATA,
    value: EVM_VALUE,
    gas: EVM_GAS,
    maxFeePerGas: EVM_MAX_FEE,
    maxPriorityFeePerGas: EVM_PRIORITY_FEE,
    nonce: EVM_NONCE,
    ...overrides,
  };
}

function signEvm(overrides: Record<string, unknown> = {}): Promise<TransactionSerialized> {
  return EVM_SIGNER.signTransaction(evmSignRequest(overrides)) as Promise<TransactionSerialized>;
}

function solanaIntent() {
  return buildSolanaSendIntent({
    network: 'solana:devnet',
    account: 'So11111111111111111111111111111111111111112',
    stealthAddress: '11111111111111111111111111111112',
    lamports: 1_000_000n,
    recentBlockhash: '11111111111111111111111111111111',
    programId: '11111111111111111111111111111111',
    instructionData: '02000000',
  });
}

function buildSolanaTransaction() {
  const payer = SolanaKeypair.generate();
  const destination = SolanaKeypair.generate().publicKey;
  const transaction = new SolanaTransaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: destination,
      lamports: 1_000_000,
    }),
  );
  transaction.recentBlockhash = '11111111111111111111111111111111';
  transaction.feePayer = payer.publicKey;
  return { transaction, payer, destination };
}

describe('canonical intent fingerprint', () => {
  it('is stable for identical intents and exposes every signed field', () => {
    const intent = stellarIntent();

    expect(fingerprintIntent(intent)).toBe(fingerprintIntent(stellarIntent()));
    expect(canonicalizeIntent(intent)).toContain('"recipient"');

    const labels = describeIntent(intent).map((field) => field.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Network',
        'Account',
        'Recipient',
        'Asset',
        'Amount',
        'Fee',
        'Memo',
        'Contract',
        'Intent fingerprint',
      ]),
    );
  });

  it.each([
    ['recipient', { stealthAddress: OTHER_STEALTH }],
    ['amount', { amount: '2' }],
    ['asset', { asset: 'USDC' }],
    ['fee', { fee: '200' }],
    ['memo', { memo: 'Tea' }],
    ['contract', { announcerContract: ANNOUNCER.replace('C', 'D') }],
    ['contract args', { viewTag: 8 }],
    ['network', { networkPassphrase: Networks.PUBLIC }],
    ['account', { address: STEALTH }],
    ['meta-address', { metaAddress: 'st:xlm:other' }],
  ])('changes when the %s changes', (_label, overrides) => {
    const base = stellarIntent();
    const changed = stellarIntent(overrides);

    expect(fingerprintIntent(changed)).not.toBe(fingerprintIntent(base));
    expect(diffIntents(base, changed).length).toBeGreaterThan(0);
  });
});

describe('stale simulation binding', () => {
  it('stays fresh for the same intent and wallet context', () => {
    const intent = stellarIntent();
    const binding = bindSimulation(intent, { fee: '100' });

    expect(simulationIsFresh(binding, stellarIntent())).toBe(true);
  });

  it.each([
    ['amount', { amount: '2' }],
    ['recipient', { stealthAddress: OTHER_STEALTH }],
    ['asset', { asset: 'USDC' }],
    ['fee', { fee: '200' }],
    ['memo', { memo: 'Tea' }],
    ['account', { address: STEALTH }],
    ['network', { networkPassphrase: Networks.PUBLIC }],
  ])('invalidates when %s changes', (_label, overrides) => {
    const intent = stellarIntent();
    const binding = bindSimulation(intent, { fee: '100' });

    expect(simulationIsFresh(binding, stellarIntent(overrides))).toBe(false);
  });

  it('fingerprints the wallet context independently from transfer fields', () => {
    const intent = stellarIntent();
    const context = walletContextFromIntent(intent);

    expect(fingerprintWalletContext(context)).toBe(
      fingerprintWalletContext(walletContextFromIntent(stellarIntent({ amount: '99' }))),
    );
  });
});

describe('stellar payload verification', () => {
  it('accepts the unchanged confirmed transaction', () => {
    const intent = stellarIntent();
    const transaction = buildStellarTransaction(intent);

    expect(verifyStellarTransactionIntent(transaction, intent).ok).toBe(true);
    expect(
      verifyStellarSignedTransaction(transaction, signStellar(transaction), STELLAR_NETWORK).ok,
    ).toBe(true);
  });

  it('rejects a wallet response that substitutes the amount', () => {
    const intent = stellarIntent();
    const confirmed = buildStellarTransaction(intent);
    const tampered = new TransactionBuilder(new Account(intent.account, intent.extra.sequence), {
      fee: intent.fee,
      networkPassphrase: STELLAR_NETWORK,
    })
      .addOperation(
        Operation.payment({
          destination: intent.recipient,
          asset: Asset.native(),
          amount: '9',
        }),
      )
      .addMemo(Memo.text(intent.memo ?? ''))
      .setTimeout(30)
      .build();

    const verification = verifyStellarSignedTransaction(
      confirmed,
      signStellar(tampered),
      STELLAR_NETWORK,
    );

    expect(verification.ok).toBe(false);
    expect(verification.mismatches.map((mismatch) => mismatch.field)).toContain('signedPayload');
  });

  it('rejects a wallet response that substitutes the recipient', () => {
    const intent = stellarIntent();
    const confirmed = buildStellarTransaction(intent);
    const tampered = new TransactionBuilder(new Account(intent.account, intent.extra.sequence), {
      fee: intent.fee,
      networkPassphrase: STELLAR_NETWORK,
    })
      .addOperation(
        Operation.payment({
          destination: OTHER_STEALTH,
          asset: Asset.native(),
          amount: intent.amount,
        }),
      )
      .addMemo(Memo.text(intent.memo ?? ''))
      .setTimeout(30)
      .build();

    expect(
      verifyStellarSignedTransaction(confirmed, signStellar(tampered), STELLAR_NETWORK).ok,
    ).toBe(false);
  });

  it('rejects an unsigned or unparseable wallet response', () => {
    const transaction = buildStellarTransaction(stellarIntent());

    expect(
      verifyStellarSignedTransaction(transaction, transaction.toXDR(), STELLAR_NETWORK).ok,
    ).toBe(false);
    expect(verifyStellarSignedTransaction(transaction, 'not-xdr', STELLAR_NETWORK).ok).toBe(false);
  });

  it('rejects a confirmed transaction whose fields drifted from the intent', () => {
    const intent = stellarIntent({ amount: '1' });
    const transaction = buildStellarTransaction(stellarIntent({ amount: '5' }));

    expect(verifyStellarTransactionIntent(transaction, intent).ok).toBe(false);
  });
});

describe('horizen payload verification', () => {
  const submitted = () => ({
    chainId: 2651420,
    from: EVM_SIGNER.address,
    to: EVM_TO as string | null,
    value: EVM_VALUE,
    input: EVM_DATA,
    gas: EVM_GAS,
    maxFeePerGas: EVM_MAX_FEE,
    maxPriorityFeePerGas: EVM_PRIORITY_FEE,
    nonce: EVM_NONCE,
    type: 'eip1559',
  });

  it('accepts the unchanged submitted transaction', () => {
    expect(verifyEvmSubmittedTransaction(evmIntent(), submitted()).ok).toBe(true);
  });

  it.each([
    ['amount', { value: 1n }],
    ['recipient', { to: '0x4444444444444444444444444444444444444444' }],
    ['contract', { input: '0xfeedface' }],
    ['network', { chainId: 1 }],
    ['account', { from: '0x5555555555555555555555555555555555555555' }],
    ['gas', { gas: 100_000n }],
    ['maxFeePerGas', { maxFeePerGas: 3_000_000_000n }],
    ['maxPriorityFeePerGas', { maxPriorityFeePerGas: 1n }],
    ['nonce', { nonce: 8 }],
    ['type', { type: 'legacy' }],
  ])('rejects a submitted transaction with a different %s', (_label, overrides) => {
    expect(verifyEvmSubmittedTransaction(evmIntent(), { ...submitted(), ...overrides }).ok).toBe(
      false,
    );
  });

  it('fails closed when fee or network fields are missing', () => {
    const {
      maxFeePerGas: _maxFeePerGas,
      chainId: _chainId,
      ...withoutRequiredFields
    } = submitted();

    expect(verifyEvmSubmittedTransaction(evmIntent(), withoutRequiredFields).ok).toBe(false);
  });

  it('accepts a wallet signed transaction that matches the reviewed intent', async () => {
    const verification = await verifyEvmSignedTransaction(evmIntent(), await signEvm());

    expect(verification.ok).toBe(true);
    expect(verification.mismatches).toEqual([]);
  });

  it.each([
    ['amount', { value: 1n }],
    ['recipient', { to: '0x4444444444444444444444444444444444444444' }],
    ['contract data', { data: '0xfeedface' }],
    ['network', { chainId: 1 }],
    ['gas', { gas: 150_000n }],
    ['maxFeePerGas', { maxFeePerGas: 3_000_000_000n }],
    ['maxPriorityFeePerGas', { maxPriorityFeePerGas: 1n }],
    ['nonce', { nonce: 8 }],
  ])('rejects a tampered signed transaction with a different %s', async (_label, overrides) => {
    const verification = await verifyEvmSignedTransaction(evmIntent(), await signEvm(overrides));

    expect(verification.ok).toBe(false);
  });

  it('rejects a signed transaction from a different account', async () => {
    const verification = await verifyEvmSignedTransaction(
      evmIntent(),
      (await EVM_OTHER_SIGNER.signTransaction(evmSignRequest())) as TransactionSerialized,
    );

    expect(verification.ok).toBe(false);
    expect(verification.mismatches.map((mismatch) => mismatch.field)).toContain('account');
  });

  it('fails closed for an unparseable wallet response', async () => {
    const verification = await verifyEvmSignedTransaction(
      evmIntent(),
      'not-a-transaction' as TransactionSerialized,
    );

    expect(verification.ok).toBe(false);
    expect(verification.mismatches.map((mismatch) => mismatch.field)).toContain('signedPayload');
  });
});

describe('solana payload verification', () => {
  it('accepts the unchanged signed message', () => {
    const { transaction, payer } = buildSolanaTransaction();
    const signed = SolanaTransaction.from(
      transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
    );
    signed.addSignature(payer.publicKey, Buffer.alloc(64, 1));

    expect(verifySolanaSignedTransaction(transaction, signed).ok).toBe(true);
  });

  it('rejects a wallet that mutated the transfer', () => {
    const { transaction, payer } = buildSolanaTransaction();
    const destination = new PublicKey('11111111111111111111111111111112');
    const tampered = new SolanaTransaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: destination,
        lamports: 5_000_000,
      }),
    );
    tampered.recentBlockhash = transaction.recentBlockhash;
    tampered.feePayer = transaction.feePayer;
    tampered.addSignature(payer.publicKey, Buffer.alloc(64, 1));

    expect(verifySolanaSignedTransaction(transaction, tampered).ok).toBe(false);
  });

  it('rejects an unsigned wallet response', () => {
    const { transaction } = buildSolanaTransaction();

    expect(verifySolanaSignedTransaction(transaction, transaction).ok).toBe(false);
  });

  it('keeps intent fields stable for the same transfer parameters', () => {
    expect(fingerprintIntent(solanaIntent())).toBe(fingerprintIntent(solanaIntent()));
  });
});

describe('ckb payload verification', () => {
  it('accepts the confirmed tx hash and rejects a substituted one', () => {
    const intent = buildCkbSendIntent({
      network: 'ckb:testnet',
      account: 'ckt1qyq',
      stealthPubKey: 'aa'.repeat(32),
      lockArgs: 'bb'.repeat(32),
      lockCodeHash: '0x' + 'cc'.repeat(32),
      capacityShannons: 10_000_000_000n,
      feeShannons: 1000n,
      txHash: '0x' + 'dd'.repeat(32),
    });

    expect(verifyCkbSignedTransaction(intent.extra.txHash, intent.extra.txHash).ok).toBe(true);
    expect(verifyCkbSignedTransaction(intent.extra.txHash, '0x' + 'ee'.repeat(32)).ok).toBe(false);
  });
});
