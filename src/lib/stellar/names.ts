import {
  TransactionBuilder,
  Account,
  Contract,
  nativeToScVal,
  Address,
  xdr,
} from '@stellar/stellar-sdk';
import { STELLAR_NETWORK } from '@/config';

// Wraith Names contract ID on Stellar Testnet
// TODO: Replace with actual contract ID from deployment
export const NAMES_CONTRACT_ID = 'CD3Z7J2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';

export interface NameMetadata {
  avatar_url?: string;
  twitter_handle?: string;
  description?: string;
}

export interface NameRecord {
  name: string;
  owner: string;
  expires_at: number;
  metadata: NameMetadata;
}

export interface RegistrationParams {
  name: string;
  duration: number; // in seconds
}

export interface TransferParams {
  name: string;
  to: string;
}

export interface RenewParams {
  name: string;
  duration: number; // in seconds
}

export interface MetadataParams {
  name: string;
  metadata: NameMetadata;
}

/**
 * Check if a name is available
 */
export async function checkAvailability(name: string): Promise<boolean> {
  try {
    const { rpc } = await import('@stellar/stellar-sdk');
    const server = new rpc.Server(STELLAR_NETWORK.rpcUrl);
    const contract = new Contract(NAMES_CONTRACT_ID);

    const result = await server.simulateTransaction(
      new TransactionBuilder(
        new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWH', '0'),
        {
          fee: '100',
          networkPassphrase: STELLAR_NETWORK.networkPassphrase,
        },
      )
        .addOperation(contract.call('get_owner', nativeToScVal(name)))
        .setTimeout(30)
        .build(),
    );

    if ('error' in result) {
      // If error, name might not exist or other issue - assume unavailable to be safe
      return false;
    }

    // If result exists, name is registered
    return false;
  } catch (error) {
    // If simulation fails, assume name is available
    return true;
  }
}

/**
 * Build a registration transaction
 */
export async function buildRegisterTransaction(
  fromAddress: string,
  params: RegistrationParams,
): Promise<string> {
  const horizonUrl = STELLAR_NETWORK.horizonUrl;
  const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

  const accountRes = await fetch(`${horizonUrl}/accounts/${fromAddress}`);
  if (!accountRes.ok) throw new Error('Failed to load account');
  const accountData = await accountRes.json();
  const sourceAccount = new Account(fromAddress, accountData.sequence);

  const contract = new Contract(NAMES_CONTRACT_ID);

  const tx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
    .addOperation(
      contract.call(
        'register',
        nativeToScVal(params.name),
        nativeToScVal(params.duration, { type: 'u64' }),
      ),
    )
    .setTimeout(30)
    .build();

  return tx.toXDR();
}

/**
 * Build a transfer transaction
 */
export async function buildTransferTransaction(
  fromAddress: string,
  params: TransferParams,
): Promise<string> {
  const horizonUrl = STELLAR_NETWORK.horizonUrl;
  const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

  const accountRes = await fetch(`${horizonUrl}/accounts/${fromAddress}`);
  if (!accountRes.ok) throw new Error('Failed to load account');
  const accountData = await accountRes.json();
  const sourceAccount = new Account(fromAddress, accountData.sequence);

  const contract = new Contract(NAMES_CONTRACT_ID);

  const tx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
    .addOperation(
      contract.call('transfer', nativeToScVal(params.name), new Address(params.to).toScVal()),
    )
    .setTimeout(30)
    .build();

  return tx.toXDR();
}

/**
 * Build a renewal transaction
 */
export async function buildRenewTransaction(
  fromAddress: string,
  params: RenewParams,
): Promise<string> {
  const horizonUrl = STELLAR_NETWORK.horizonUrl;
  const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

  const accountRes = await fetch(`${horizonUrl}/accounts/${fromAddress}`);
  if (!accountRes.ok) throw new Error('Failed to load account');
  const accountData = await accountRes.json();
  const sourceAccount = new Account(fromAddress, accountData.sequence);

  const contract = new Contract(NAMES_CONTRACT_ID);

  const tx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
    .addOperation(
      contract.call(
        'renew',
        nativeToScVal(params.name),
        nativeToScVal(params.duration, { type: 'u64' }),
      ),
    )
    .setTimeout(30)
    .build();

  return tx.toXDR();
}

/**
 * Build a metadata update transaction
 */
export async function buildSetMetadataTransaction(
  fromAddress: string,
  params: MetadataParams,
): Promise<string> {
  const horizonUrl = STELLAR_NETWORK.horizonUrl;
  const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

  const accountRes = await fetch(`${horizonUrl}/accounts/${fromAddress}`);
  if (!accountRes.ok) throw new Error('Failed to load account');
  const accountData = await accountRes.json();
  const sourceAccount = new Account(fromAddress, accountData.sequence);

  const contract = new Contract(NAMES_CONTRACT_ID);

  // Build metadata map
  const metadataMap: xdr.ScMapEntry[] = [
    new xdr.ScMapEntry({
      key: nativeToScVal('avatar_url'),
      val: params.metadata.avatar_url
        ? nativeToScVal(params.metadata.avatar_url)
        : xdr.ScVal.scvVoid(),
    }),
    new xdr.ScMapEntry({
      key: nativeToScVal('twitter_handle'),
      val: params.metadata.twitter_handle
        ? nativeToScVal(params.metadata.twitter_handle)
        : xdr.ScVal.scvVoid(),
    }),
    new xdr.ScMapEntry({
      key: nativeToScVal('description'),
      val: params.metadata.description
        ? nativeToScVal(params.metadata.description)
        : xdr.ScVal.scvVoid(),
    }),
  ];

  const tx = new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
    .addOperation(
      contract.call('set_metadata', nativeToScVal(params.name), xdr.ScVal.scvMap(metadataMap)),
    )
    .setTimeout(30)
    .build();

  return tx.toXDR();
}

/**
 * Get name record from contract
 */
export async function getNameRecord(name: string): Promise<NameRecord | null> {
  try {
    const { rpc } = await import('@stellar/stellar-sdk');
    const server = new rpc.Server(STELLAR_NETWORK.rpcUrl);
    const contract = new Contract(NAMES_CONTRACT_ID);

    const result = await server.simulateTransaction(
      new TransactionBuilder(
        new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWH', '0'),
        {
          fee: '100',
          networkPassphrase: STELLAR_NETWORK.networkPassphrase,
        },
      )
        .addOperation(contract.call('get_record', nativeToScVal(name)))
        .setTimeout(30)
        .build(),
    );

    if ('error' in result) {
      return null;
    }

    // Parse the result - this depends on actual contract return structure
    // For now, return a placeholder
    return {
      name,
      owner: '',
      expires_at: 0,
      metadata: {},
    };
  } catch {
    return null;
  }
}

/**
 * Get all names owned by an address
 */
export async function getOwnedNames(ownerAddress: string): Promise<string[]> {
  try {
    const { rpc } = await import('@stellar/stellar-sdk');
    const server = new rpc.Server(STELLAR_NETWORK.rpcUrl);
    const contract = new Contract(NAMES_CONTRACT_ID);

    const result = await server.simulateTransaction(
      new TransactionBuilder(
        new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWH', '0'),
        {
          fee: '100',
          networkPassphrase: STELLAR_NETWORK.networkPassphrase,
        },
      )
        .addOperation(contract.call('get_names_by_owner', new Address(ownerAddress).toScVal()))
        .setTimeout(30)
        .build(),
    );

    if ('error' in result) {
      return [];
    }

    // Parse the result - this depends on actual contract return structure
    // For now, return empty array
    return [];
  } catch {
    return [];
  }
}

/**
 * Submit a signed transaction to the network
 */
export async function submitTransaction(signedXdr: string): Promise<string> {
  const { rpc } = await import('@stellar/stellar-sdk');
  const server = new rpc.Server(STELLAR_NETWORK.rpcUrl);

  const tx = TransactionBuilder.fromXDR(signedXdr, STELLAR_NETWORK.networkPassphrase);
  const result = await server.sendTransaction(tx);

  if (result.status === 'ERROR') {
    throw new Error(result.errorResult?.toString() || 'Transaction failed');
  }

  return result.hash;
}
