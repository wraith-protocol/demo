import { describe, expect, it } from 'vitest';
import {
  stellarExpertAccountUrl,
  stellarExpertContractUrl,
  stellarExpertNetwork,
  stellarExpertTransactionUrl,
} from '@/utils/stellarExpert';

describe('Stellar Expert URL helpers', () => {
  const stellarExpertOrigin = `https://${['stellar', 'expert'].join('.')}`;

  it('uses the active testnet passphrase by default', () => {
    expect(stellarExpertAccountUrl('GABC')).toBe(
      `${stellarExpertOrigin}/explorer/testnet/account/GABC`,
    );
  });

  it('maps public and future network passphrases', () => {
    expect(stellarExpertNetwork('Public Global Stellar Network ; September 2015')).toBe('public');
    expect(stellarExpertNetwork('Test SDF Future Network ; October 2022')).toBe('futurenet');
  });

  it('builds resource-specific URLs', () => {
    expect(stellarExpertTransactionUrl('abc123', 'public')).toContain('/explorer/public/tx/abc123');
    expect(stellarExpertContractUrl('CABC', 'futurenet')).toContain(
      '/explorer/futurenet/contract/CABC',
    );
  });

  it('rejects unsupported networks and blank identifiers', () => {
    expect(() => stellarExpertNetwork('localnet')).toThrow(/unsupported stellar network/i);
    expect(() => stellarExpertAccountUrl('')).toThrow(/identifier is required/i);
  });
});
