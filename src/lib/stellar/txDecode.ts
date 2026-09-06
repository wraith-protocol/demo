import { TransactionBuilder, Memo, Operation } from '@stellar/stellar-sdk';
import { STELLAR_NETWORK } from '@/config';

export interface DecodedOperation {
  type: string;
  [key: string]: unknown;
}

export interface DecodedTransaction {
  source: string;
  fee: number;
  memo: Memo | null;
  operations: DecodedOperation[];
  signatures: string[];
  envelopeXdr: string;
}

export function decodeTxEnvelope(xdr: string): DecodedTransaction {
  if (!xdr.trim()) {
    throw new Error('Empty XDR');
  }
  const tx = TransactionBuilder.fromXDR(
    xdr,
    STELLAR_NETWORK.networkPassphrase,
  ) as any;
  const operations: DecodedOperation[] = tx.operations.map(
    (op: Operation) => {
      const decoded: DecodedOperation = { type: op.type };
      Object.entries(op).forEach(([key, value]) => {
        if (typeof value !== 'function') {
          decoded[key] = value;
        }
      });
      return decoded;
    },
  );
  const signatures = tx.signatures
    ? tx.signatures.map((s: any) => s.signature().toString('base64'))
    : [];
  return {
    source: tx.source,
    fee: Number(tx.fee),
    memo: tx.memo ?? null,
    operations,
    signatures,
    envelopeXdr: xdr,
  };
}
