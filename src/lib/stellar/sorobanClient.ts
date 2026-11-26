import type { FeeBumpTransaction, Transaction } from '@stellar/stellar-sdk';
import { STELLAR_NETWORK } from '@/config';

type SorobanTransaction = Transaction | FeeBumpTransaction;

export interface SorobanAccountLike {
  accountId(): string;
  sequenceNumber(): string;
}

export interface SorobanServerLike {
  getAccount(address: string): Promise<SorobanAccountLike>;
  simulateTransaction(tx: SorobanTransaction): Promise<unknown>;
  sendTransaction(tx: SorobanTransaction): Promise<{ status: string; hash: string }>;
  getTransaction(hash: string): Promise<{ status: string }>;
}

function isServerLike(value: unknown): value is SorobanServerLike {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.getAccount === 'function' &&
    typeof candidate.simulateTransaction === 'function' &&
    typeof candidate.sendTransaction === 'function' &&
    typeof candidate.getTransaction === 'function'
  );
}

export function getSorobanServer(
  rpcModule: typeof import('@stellar/stellar-sdk').rpc,
): SorobanServerLike {
  const mock = (window as Window & { sorobanServerMock?: unknown }).sorobanServerMock;
  if (isServerLike(mock)) return mock;
  return new rpcModule.Server(STELLAR_NETWORK.rpcUrl);
}
