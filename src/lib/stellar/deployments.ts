/**
 * Typed Stellar deployment configuration, resolved once per supported network.
 *
 * Before this module the announcer and registry IDs were re-declared as string
 * literals in the send page, the receive page, the simulation helper and the
 * service worker, so a redeploy meant editing four files and any one of them
 * could silently disagree with the others. Every call site now resolves through
 * `getStellarContractId`, which:
 *
 * 1. reads the ID for the *selected* network from `./deployment-manifest.ts`
 *    (with an environment override for a fresh deployment),
 * 2. rejects an unknown selected network instead of guessing a passphrase,
 * 3. rejects a contract that has no deployment on the selected network,
 * 4. rejects a value that is not a structurally valid contract address.
 *
 * Failure is thrown rather than defaulted: scanning or announcing against the
 * wrong contract either returns nothing (which looks like an empty inbox) or
 * writes an announcement nobody can find, and both read as success to the user.
 *
 * This module deliberately has no Stellar SDK imports so it can be bundled into
 * the service worker and the scanner worker, the same rule `rpcEvents.ts`
 * follows.
 */
import {
  STELLAR_DEPLOYMENT_MANIFEST,
  type StellarContractName,
  type StellarNetworkName,
} from './deployment-manifest';

export type { StellarContractName, StellarNetworkName } from './deployment-manifest';

export interface StellarNetworkConfig {
  name: StellarNetworkName;
  /** Human-readable name shown in the UI and the network-mismatch warning. */
  label: string;
  networkPassphrase: string;
  rpcUrl: string;
  horizonUrl: string;
}

export const STELLAR_NETWORKS: Record<StellarNetworkName, StellarNetworkConfig> = {
  testnet: {
    name: 'testnet',
    label: 'Stellar Testnet',
    networkPassphrase: 'Test SDF Network ; September 2015',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    horizonUrl: 'https://horizon-testnet.stellar.org',
  },
  futurenet: {
    name: 'futurenet',
    label: 'Stellar Futurenet',
    networkPassphrase: 'Test SDF Future Network ; October 2022',
    rpcUrl: 'https://rpc-futurenet.stellar.org',
    horizonUrl: 'https://horizon-futurenet.stellar.org',
  },
  public: {
    name: 'public',
    label: 'Stellar Public Network',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    rpcUrl: 'https://soroban.stellar.org',
    horizonUrl: 'https://horizon.stellar.org',
  },
};

const CONTRACT_ENV_VARS: Record<StellarContractName, string> = {
  announcer: 'VITE_STELLAR_ANNOUNCER_CONTRACT_ID',
  registry: 'VITE_STELLAR_REGISTRY_CONTRACT_ID',
  names: 'VITE_WRAITH_NAMES_CONTRACT_ID',
};

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * The strkey version byte for contract addresses (the `C` prefix), already
 * bit-shifted as it appears on the wire. `deployments.test.ts` pins this against
 * the SDK encoder.
 */
const CONTRACT_VERSION_BYTE = 16;

/** Version byte, 32-byte key, then a 2-byte SEP-23 checksum. */
const CONTRACT_ADDRESS_BYTES = 1 + 32 + 2;

function readEnv(name: string): string | undefined {
  const value = (import.meta.env as Record<string, string | undefined>)[name];
  return value && value.trim() ? value.trim() : undefined;
}

function decodeBase32(text: string): Uint8Array | null {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of text) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) return null;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }

  return Uint8Array.from(bytes);
}

/** CRC-16/XMODEM used by SEP-23 strkeys: polynomial 0x1021, initial value 0. */
function crc16XModem(payload: Uint8Array): number {
  let crc = 0x0000;
  for (const byte of payload) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/**
 * Structural check for a Stellar contract address: 56 unpadded base32
 * characters that decode to a contract version byte, a 32-byte key and a
 * matching SEP-23 checksum.
 */
export function isStellarContractId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 56) return false;

  const bytes = decodeBase32(value);
  if (!bytes || bytes.length !== CONTRACT_ADDRESS_BYTES) return false;
  if (bytes[0] !== CONTRACT_VERSION_BYTE) return false;

  const checksum = crc16XModem(bytes.subarray(0, 1 + 32));
  return bytes[33] === (checksum & 0xff) && bytes[34] === ((checksum >>> 8) & 0xff);
}

export function isStellarNetworkName(value: unknown): value is StellarNetworkName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STELLAR_NETWORKS, value);
}

/**
 * Map a network passphrase to its network, or `null` for a network this app has
 * no deployment table for (a standalone or custom network, for example).
 * Callers holding a wallet-supplied passphrase use this to refuse to act on a
 * network whose contract IDs cannot be known.
 */
export function stellarNetworkForPassphrase(passphrase: string): StellarNetworkConfig | null {
  return (
    Object.values(STELLAR_NETWORKS).find((network) => network.networkPassphrase === passphrase) ??
    null
  );
}

/**
 * The network the app runs against. `VITE_STELLAR_NETWORK` selects it; an
 * unrecognised value is a configuration error rather than a silent fallback to
 * testnet, because a fallback would sign testnet transactions while the rest of
 * the app assumed a different network.
 */
export function getStellarNetworkConfig(): StellarNetworkConfig {
  const requested = readEnv('VITE_STELLAR_NETWORK') ?? 'testnet';
  if (!isStellarNetworkName(requested)) {
    throw new Error(
      `Stellar network "${requested}" is not supported. ` +
        `Set VITE_STELLAR_NETWORK to one of: ${Object.keys(STELLAR_NETWORKS).join(', ')}.`,
    );
  }
  return STELLAR_NETWORKS[requested];
}

/**
 * Resolve a required contract for the selected (or given) network, returning it
 * only once it is a valid contract address.
 */
export function getStellarContractId(
  contract: StellarContractName,
  network: StellarNetworkName = getStellarNetworkConfig().name,
): string {
  const networkConfig = STELLAR_NETWORKS[network];
  if (!networkConfig) {
    throw new Error(
      `No Stellar deployment configuration for network "${String(network)}"; refusing to guess contract IDs.`,
    );
  }

  const envVar = CONTRACT_ENV_VARS[contract];
  const contractId = readEnv(envVar) ?? STELLAR_DEPLOYMENT_MANIFEST[network][contract] ?? '';

  if (!contractId) {
    throw new Error(
      `The Wraith ${contract} contract is not deployed on ${networkConfig.label}; ` +
        `set ${envVar} to point at a deployment.`,
    );
  }

  if (!isStellarContractId(contractId)) {
    throw new Error(
      `${networkConfig.label} ${contract} contract ID "${contractId}" is not a valid Stellar contract address.`,
    );
  }

  return contractId;
}

/**
 * Non-throwing variant for display-only paths (explorer links, contact-label
 * lookups) that must keep rendering when a contract has no deployment. Anything
 * that builds or scans a transaction must use `getStellarContractId` instead.
 */
export function tryGetStellarContractId(
  contract: StellarContractName,
  network?: StellarNetworkName,
): string {
  try {
    return getStellarContractId(contract, network);
  } catch {
    return '';
  }
}
