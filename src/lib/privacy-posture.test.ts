import { describe, expect, it } from 'vitest';
import { getPrivacyPosture, getRpcHost, type RpcRoute } from './privacy-posture';

const defaultRoute: RpcRoute = {
  chain: 'stellar',
  url: 'https://soroban-testnet.stellar.org',
  defaultUrl: 'https://soroban-testnet.stellar.org',
};

const privateRoute: RpcRoute = {
  chain: 'stellar',
  url: 'https://rpc.example.internal',
  defaultUrl: 'https://soroban-testnet.stellar.org',
};

describe('getPrivacyPosture', () => {
  it('is strict when telemetry is off and all relevant RPC routes are non-default', () => {
    expect(getPrivacyPosture(false, [privateRoute])).toBe('strict');
  });

  it('is relaxed when telemetry is on with a non-default RPC', () => {
    expect(getPrivacyPosture(true, [privateRoute])).toBe('relaxed');
  });

  it('is relaxed when telemetry is off with a default RPC', () => {
    expect(getPrivacyPosture(false, [defaultRoute])).toBe('relaxed');
  });

  it('is relaxed when telemetry is on with a default RPC', () => {
    expect(getPrivacyPosture(true, [defaultRoute])).toBe('relaxed');
  });

  it('uses only the active chain when deriving posture', () => {
    const defaultSolanaRoute: RpcRoute = {
      chain: 'solana',
      url: 'https://api.devnet.solana.com',
      defaultUrl: 'https://api.devnet.solana.com',
    };

    expect(getPrivacyPosture(false, [privateRoute, defaultSolanaRoute], 'stellar')).toBe('strict');
    expect(getPrivacyPosture(false, [privateRoute, defaultSolanaRoute], 'solana')).toBe('relaxed');
  });

  it('treats RPC query-string differences as non-default routing', () => {
    const proxiedRoute: RpcRoute = {
      chain: 'stellar',
      url: 'https://rpc.example.test/http?upstream=private',
      defaultUrl: 'https://rpc.example.test/http?upstream=public',
    };

    expect(getPrivacyPosture(false, [proxiedRoute], 'stellar')).toBe('strict');
  });

  it('is relaxed when the active chain has no configured routes', () => {
    expect(getPrivacyPosture(false, [privateRoute], 'ckb')).toBe('relaxed');
  });
});

describe('getRpcHost', () => {
  it('extracts a copyable host without leaking path details', () => {
    expect(getRpcHost('https://testnet.ckb.dev/rpc')).toBe('testnet.ckb.dev');
  });
});
