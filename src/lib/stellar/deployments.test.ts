import { afterEach, describe, expect, it, vi } from 'vitest';
import { Networks, StrKey } from '@stellar/stellar-sdk';
import { STELLAR_DEPLOYMENT_MANIFEST } from './deployment-manifest';
import {
  STELLAR_NETWORKS,
  getStellarContractId,
  getStellarNetworkConfig,
  isStellarContractId,
  isStellarNetworkName,
  stellarNetworkForPassphrase,
} from './deployments';

const ANNOUNCER_TESTNET = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
const REGISTRY_TESTNET = 'CC2LAUCXYOPJ4DV4CYXNXYAXRDVOTMAWFF76W4WFD5OVQBD6TN4PYYJ5';

/** A valid address with one payload character changed: same shape, broken checksum. */
function corrupt(contractId: string): string {
  const index = 20;
  const replacement = contractId[index] === 'A' ? 'B' : 'A';
  return `${contractId.slice(0, index)}${replacement}${contractId.slice(index + 1)}`;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Stellar deployment manifest', () => {
  it('only lists contract addresses the SDK accepts', () => {
    for (const [network, contracts] of Object.entries(STELLAR_DEPLOYMENT_MANIFEST)) {
      for (const [contract, contractId] of Object.entries(contracts)) {
        expect(StrKey.isValidContract(contractId as string), `${network}.${contract}`).toBe(true);
      }
    }
  });

  it('is what the app resolves, so no call site can drift from it', () => {
    expect(getStellarContractId('announcer', 'testnet')).toBe(ANNOUNCER_TESTNET);
    expect(getStellarContractId('registry', 'testnet')).toBe(REGISTRY_TESTNET);
  });

  it('binds each contract to at most one network', () => {
    const seen = new Map<string, string>();
    for (const [network, contracts] of Object.entries(STELLAR_DEPLOYMENT_MANIFEST)) {
      for (const [contract, contractId] of Object.entries(contracts)) {
        const previous = seen.get(contractId as string);
        expect(previous, `${contract} on ${network} duplicates ${previous}`).toBeUndefined();
        seen.set(contractId as string, `${network}.${contract}`);
      }
    }
  });
});

describe('isStellarContractId', () => {
  it('agrees with the SDK on deployed addresses', () => {
    for (const contractId of [ANNOUNCER_TESTNET, REGISTRY_TESTNET]) {
      expect(isStellarContractId(contractId)).toBe(true);
      expect(StrKey.isValidContract(contractId)).toBe(true);
    }
  });

  it('agrees with the SDK on freshly encoded addresses', () => {
    for (let i = 0; i < 8; i += 1) {
      const key = Buffer.alloc(32);
      for (let byte = 0; byte < 32; byte += 1) key[byte] = byte + i;
      const contractId = StrKey.encodeContract(key);
      expect(isStellarContractId(contractId), contractId).toBe(true);
    }
  });

  it('rejects a corrupted checksum, a wrong version byte, and non-addresses', () => {
    expect(isStellarContractId(corrupt(ANNOUNCER_TESTNET))).toBe(false);
    expect(StrKey.isValidContract(corrupt(ANNOUNCER_TESTNET))).toBe(false);

    // Same length and alphabet, but an account (G...) rather than a contract.
    const accountId = 'GAK6Z5UVGUVSEK6PEOCAYJIMT7EGF4LI6G35XZJH5V3K2T6OZZWZST5D';
    expect(isStellarContractId(accountId)).toBe(false);

    expect(isStellarContractId('')).toBe(false);
    expect(isStellarContractId(ANNOUNCER_TESTNET.slice(0, 55))).toBe(false);
    expect(isStellarContractId('not-a-contract-id')).toBe(false);
    expect(isStellarContractId(undefined)).toBe(false);
  });
});

describe('network selection', () => {
  it('uses passphrases the SDK publishes', () => {
    expect(STELLAR_NETWORKS.testnet.networkPassphrase).toBe(Networks.TESTNET);
    expect(STELLAR_NETWORKS.futurenet.networkPassphrase).toBe(Networks.FUTURENET);
    expect(STELLAR_NETWORKS.public.networkPassphrase).toBe(Networks.PUBLIC);
  });

  it('maps a wallet passphrase back to its network', () => {
    expect(stellarNetworkForPassphrase(Networks.TESTNET)?.name).toBe('testnet');
    expect(stellarNetworkForPassphrase('Public Network ; January 2010')).toBeNull();
  });

  it('defaults to testnet', () => {
    expect(getStellarNetworkConfig().name).toBe('testnet');
    expect(isStellarNetworkName('testnet')).toBe(true);
    expect(isStellarNetworkName('mainnet')).toBe(false);
  });

  it('fails closed on an unsupported selected network instead of guessing', () => {
    vi.stubEnv('VITE_STELLAR_NETWORK', 'stagingnet');
    expect(() => getStellarNetworkConfig()).toThrow(/not supported/);
    expect(() => getStellarContractId('announcer')).toThrow(/not supported/);
  });
});

describe('getStellarContractId fail-closed paths', () => {
  it('refuses a contract with no deployment on the selected network', () => {
    expect(() => getStellarContractId('announcer', 'public')).toThrow(/not deployed/);
    expect(() => getStellarContractId('names', 'testnet')).toThrow(/not deployed/);
  });

  it('refuses an unsupported network rather than falling back to testnet', () => {
    expect(() => getStellarContractId('announcer', 'mainnet' as 'public')).toThrow(
      /No Stellar deployment configuration/,
    );
  });

  it('rejects an override that is not a contract address', () => {
    vi.stubEnv('VITE_STELLAR_ANNOUNCER_CONTRACT_ID', corrupt(REGISTRY_TESTNET));
    expect(() => getStellarContractId('announcer', 'testnet')).toThrow(
      /is not a valid Stellar contract address/,
    );
  });

  it('takes an override for a redeploy without touching the manifest', () => {
    const redeployed = StrKey.encodeContract(
      Buffer.from(Array.from({ length: 32 }, (_, byte) => byte + 40)),
    );
    vi.stubEnv('VITE_STELLAR_REGISTRY_CONTRACT_ID', redeployed);
    expect(getStellarContractId('registry', 'testnet')).toBe(redeployed);
  });

  it('ignores a blank override so a mis-set env var cannot disable the manifest', () => {
    vi.stubEnv('VITE_STELLAR_ANNOUNCER_CONTRACT_ID', '   ');
    expect(getStellarContractId('announcer', 'testnet')).toBe(ANNOUNCER_TESTNET);
  });
});
