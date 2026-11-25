import { describe, expect, it } from 'vitest';
import { Account, Asset, Operation } from '@stellar/stellar-sdk';
import { deriveStealthKeys, encodeStealthMetaAddress } from '@wraith-protocol/sdk/chains/stellar';
import {
  formatAsset,
  getMinAmount,
  validateAmount,
  validateMetaAddress,
  buildPaymentTransaction,
  buildAnnouncementTransaction,
} from './sendTransactionBuilder';

function randomSignature(): Uint8Array {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return bytes;
}

describe('sendTransactionBuilder', () => {
  const keys = deriveStealthKeys(randomSignature());
  const validMetaAddress = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);

  describe('validateMetaAddress', () => {
    it('rejects empty address', () => {
      expect(validateMetaAddress('')).toBe('Recipient meta-address is required');
    });

    it('rejects address with invalid prefix', () => {
      expect(validateMetaAddress('st:eth:1234567890')).toBe(
        'Not a valid Stellar stealth meta-address',
      );
      expect(validateMetaAddress('GABCD1234567890')).toBe(
        'Not a valid Stellar stealth meta-address',
      );
    });

    it('rejects address with corrupted payload', () => {
      expect(validateMetaAddress('st:xlm:invalid_base58_corrupted')).toBe(
        'Not a valid Stellar stealth meta-address',
      );
    });

    it('accepts a valid Stellar stealth meta-address', () => {
      expect(validateMetaAddress(validMetaAddress)).toBe('');
    });
  });

  describe('validateAmount', () => {
    it('rejects empty amount', () => {
      expect(validateAmount('', 'XLM')).toBe('Amount is required');
    });

    it('rejects invalid or non-numeric strings', () => {
      expect(validateAmount('abc', 'XLM')).toBe('Enter a valid XLM amount');
      expect(validateAmount('-5', 'XLM')).toBe('Enter a valid XLM amount');
      expect(validateAmount('1.2.3', 'XLM')).toBe('Enter a valid XLM amount');
    });

    it('rejects amounts exceeding decimal precision', () => {
      expect(validateAmount('1.12345678', 'XLM')).toBe('XLM supports up to 7 decimals');
    });

    it('rejects amounts less than or equal to minimum amount', () => {
      expect(validateAmount('0', 'XLM')).toContain('Amount must be greater than');
      expect(validateAmount('0.0000001', 'XLM')).toContain('Amount must be greater than');
    });

    it('accepts valid amounts', () => {
      expect(validateAmount('10', 'XLM')).toBe('');
      expect(validateAmount('0.5', 'XLM')).toBe('');
      expect(validateAmount('100.1234567', 'XLM')).toBe('');
      expect(validateAmount('25.50', 'USDC')).toBe('');
    });
  });

  describe('formatAsset', () => {
    it('formats numbers with proper decimal places and strips trailing zeros', () => {
      expect(formatAsset(10.5, 'XLM')).toBe('10.5');
      expect(formatAsset(10.0, 'XLM')).toBe('10');
      expect(formatAsset(0.0000001, 'XLM')).toBe('0.0000001');
    });
  });

  describe('buildPaymentTransaction', () => {
    const dummySource = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
    const dummyDest = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
    const sourceAccount = new Account(dummySource, '100');
    const networkPassphrase = 'Test SDF Network ; September 2015';

    it('builds payment op when destination account exists', () => {
      const tx = buildPaymentTransaction({
        sourceAccount,
        destination: dummyDest,
        asset: Asset.native(),
        amount: '10',
        isNative: true,
        destinationExists: true,
        networkPassphrase,
      });

      expect(tx.operations).toHaveLength(1);
      const op = tx.operations[0];
      expect(op.type).toBe('payment');
      if (op.type === 'payment') {
        expect(op.destination).toBe(dummyDest);
        expect(op.amount).toBe('10.0000000');
      }
    });

    it('builds createAccount op when destination does not exist and asset is native', () => {
      const tx = buildPaymentTransaction({
        sourceAccount,
        destination: dummyDest,
        asset: Asset.native(),
        amount: '5',
        isNative: true,
        destinationExists: false,
        networkPassphrase,
      });

      expect(tx.operations).toHaveLength(1);
      const op = tx.operations[0];
      expect(op.type).toBe('createAccount');
      if (op.type === 'createAccount') {
        expect(op.destination).toBe(dummyDest);
        expect(op.startingBalance).toBe('5.0000000');
      }
    });

    it('builds payment op when destination does not exist and asset is non-native', () => {
      const usdcAsset = new Asset('USDC', dummySource);
      const tx = buildPaymentTransaction({
        sourceAccount,
        destination: dummyDest,
        asset: usdcAsset,
        amount: '20',
        isNative: false,
        destinationExists: false,
        networkPassphrase,
      });

      expect(tx.operations).toHaveLength(1);
      const op = tx.operations[0];
      expect(op.type).toBe('payment');
      if (op.type === 'payment') {
        expect(op.destination).toBe(dummyDest);
        expect(op.amount).toBe('20.0000000');
        expect(op.asset.code).toBe('USDC');
      }
    });

    it('attaches text memo when provided', () => {
      const tx = buildPaymentTransaction({
        sourceAccount,
        destination: dummyDest,
        asset: Asset.native(),
        amount: '1',
        isNative: true,
        destinationExists: true,
        networkPassphrase,
        memo: 'Payment for services',
      });

      expect(tx.memo.value).toBe('Payment for services');
    });
  });

  describe('buildAnnouncementTransaction', () => {
    const dummySource = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
    const dummyDest = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
    const dummyContract = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
    const sourceAccount = new Account(dummySource, '105');
    const networkPassphrase = 'Test SDF Network ; September 2015';

    it('builds invokeHostFunction op for contract announcement', () => {
      const tx = buildAnnouncementTransaction({
        sourceAccount,
        announcerContractId: dummyContract,
        schemeId: 1,
        stealthAddress: dummyDest,
        ephemeralPubKey: new Uint8Array(32).fill(3),
        viewTag: 42,
        networkPassphrase,
      });

      expect(tx.operations).toHaveLength(1);
      expect(tx.operations[0].type).toBe('invokeHostFunction');
    });
  });
});
