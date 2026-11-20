import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import {
  bytesToHex,
  decodeStealthMetaAddress,
  generateStealthAddress,
} from '@wraith-protocol/sdk/chains/stellar';
import { Buffer } from 'buffer';
import { STELLAR_NETWORK } from '@/config';

const STORAGE_PREFIX = 'wraith:stellar-vault-deposits:v1';

export type VaultDepositProgress =
  | { status: 'simulating' }
  | { status: 'signing'; fee: string }
  | { status: 'pending'; txHash: string }
  | { status: 'success'; txHash: string; depositId: string };

export interface SubmitVaultDepositParams {
  sender: string;
  metaAddress: string;
  amount: string;
  unlockLedger: number;
  refundWindow: number;
  signTransaction: (xdr: string) => Promise<string>;
  onProgress?: (progress: VaultDepositProgress) => void;
}

export interface PersistedVaultDeposit {
  depositId: string;
  txHash: string;
  sender: string;
  recipient: string;
  ephemeralPubKey: string;
  metaAddress: string;
  amount: string;
  unlockLedger: number;
  refundAfter: number;
  createdAt: number;
}

type VaultServer = {
  getAccount(address: string): Promise<Account>;
  simulateTransaction(transaction: unknown): Promise<any>;
  sendTransaction(transaction: unknown): Promise<any>;
  pollTransaction(hash: string, options?: { attempts?: number }): Promise<any>;
  assembleTransaction?: (
    transaction: unknown,
    simulation: unknown,
  ) => { build(): { toXDR(): string } } | Promise<{ build(): { toXDR(): string } }>;
};

export function getVaultContractId(): string {
  const runtimeId =
    typeof window !== 'undefined' ? window.__WRAITH_CONFIG__?.stellarVaultContractId : undefined;
  return runtimeId || import.meta.env.VITE_STELLAR_VAULT_CONTRACT_ID || '';
}

function getServer(): VaultServer {
  if (typeof window !== 'undefined' && window.sorobanServerMock) {
    return window.sorobanServerMock as VaultServer;
  }
  return new rpc.Server(STELLAR_NETWORK.rpcUrl) as unknown as VaultServer;
}

function parseXlmAmount(amount: string): bigint {
  const [whole, fraction = ''] = amount.split('.');
  const stroops = `${whole || '0'}${fraction.padEnd(7, '0')}`;
  return BigInt(stroops);
}

function formatSimulationError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const contractError = message.match(/Error\(Contract, #(\d+)\)/);
  return contractError
    ? `Vault contract rejected the deposit (error #${contractError[1]})`
    : message;
}

function normalizeDepositId(value: unknown): string {
  const nativeValue = value instanceof xdr.ScVal ? scValToNative(value) : value;
  if (nativeValue instanceof Uint8Array) return Buffer.from(nativeValue).toString('hex');
  if (typeof nativeValue === 'string' && /^[0-9a-f]{64}$/i.test(nativeValue)) {
    return nativeValue.toLowerCase();
  }
  throw new Error('Confirmed vault transaction did not return a valid deposit ID');
}

export function loadPersistedVaultDeposits(sender: string): PersistedVaultDeposit[] {
  const raw = localStorage.getItem(`${STORAGE_PREFIX}:${sender}`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PersistedVaultDeposit[]) : [];
  } catch {
    return [];
  }
}

function persistVaultDeposit(deposit: PersistedVaultDeposit) {
  const key = `${STORAGE_PREFIX}:${deposit.sender}`;
  const existing = loadPersistedVaultDeposits(deposit.sender).filter(
    (entry) => entry.depositId !== deposit.depositId,
  );
  localStorage.setItem(key, JSON.stringify([deposit, ...existing]));
}

export async function submitVaultDeposit(
  params: SubmitVaultDepositParams,
): Promise<PersistedVaultDeposit> {
  const contractId = getVaultContractId();
  if (!contractId) {
    throw new Error('Stealth vault contract is not configured for Stellar Testnet');
  }

  const decoded = decodeStealthMetaAddress(params.metaAddress);
  const stealth = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);
  const refundAfter = params.unlockLedger + params.refundWindow;
  if (!Number.isSafeInteger(refundAfter) || refundAfter > 0xffffffff) {
    throw new Error('Refund ledger is outside the supported range');
  }

  const server = getServer();
  const sourceAccount = await server.getAccount(params.sender);
  const nativeAssetContract = Asset.native().contractId(STELLAR_NETWORK.networkPassphrase);
  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK.networkPassphrase,
  })
    .addOperation(
      new Contract(contractId).call(
        'deposit',
        new Address(params.sender).toScVal(),
        new Address(stealth.stealthAddress).toScVal(),
        nativeToScVal(parseXlmAmount(params.amount), { type: 'i128' }),
        new Address(nativeAssetContract).toScVal(),
        nativeToScVal(params.unlockLedger, { type: 'u32' }),
        nativeToScVal(refundAfter, { type: 'u32' }),
        xdr.ScVal.scvBytes(Buffer.from(stealth.ephemeralPubKey)),
      ),
    )
    .setTimeout(30)
    .build();

  params.onProgress?.({ status: 'simulating' });
  const simulation = await server.simulateTransaction(transaction);
  if ('error' in simulation) {
    throw new Error(formatSimulationError(simulation.error));
  }

  const fee = String(simulation.minResourceFee ?? BASE_FEE);
  params.onProgress?.({ status: 'signing', fee });
  const assembled = server.assembleTransaction
    ? await server.assembleTransaction(transaction, simulation)
    : rpc.assembleTransaction(transaction, simulation);
  const signedXdr = await params.signTransaction(assembled.build().toXDR());
  const signedTransaction = TransactionBuilder.fromXDR(
    signedXdr,
    STELLAR_NETWORK.networkPassphrase,
  );

  const submitted = await server.sendTransaction(signedTransaction);
  if (submitted.status === 'ERROR' || !submitted.hash) {
    throw new Error(
      formatSimulationError(submitted.errorResult?.toString?.() || 'Vault submission failed'),
    );
  }

  params.onProgress?.({ status: 'pending', txHash: submitted.hash });
  const result = await server.pollTransaction(submitted.hash, { attempts: 30 });
  if (result.status === 'FAILED') {
    throw new Error('Vault deposit failed on Stellar Testnet');
  }
  if (result.status !== 'SUCCESS') {
    throw new Error('Vault deposit is still pending after the confirmation window');
  }

  const depositId = normalizeDepositId(result.returnValue);
  const persisted: PersistedVaultDeposit = {
    depositId,
    txHash: submitted.hash,
    sender: params.sender,
    recipient: stealth.stealthAddress,
    ephemeralPubKey: bytesToHex(stealth.ephemeralPubKey),
    metaAddress: params.metaAddress,
    amount: params.amount,
    unlockLedger: params.unlockLedger,
    refundAfter,
    createdAt: Date.now(),
  };
  persistVaultDeposit(persisted);
  params.onProgress?.({ status: 'success', txHash: submitted.hash, depositId });
  return persisted;
}
