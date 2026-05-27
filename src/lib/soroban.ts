import { TransactionBuilder, Account, xdr } from '@stellar/stellar-sdk';
import { STELLAR_NETWORK } from '@/config';

export interface SimulationSuccess {
  ok: true;
  minResourceFee: string;
  predictedFeeStroops: string;
  returnValue: string | null;
  eventCount: number;
  transactionData: string;
  latestLedger: number;
}

export interface SimulationFailure {
  ok: false;
  error: string;
  isNetworkError: boolean;
}

export type SimulationResult = SimulationSuccess | SimulationFailure;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let rpcModule: any = null;

async function getRpcModule() {
  if (!rpcModule) {
    const sdk = await import('@stellar/stellar-sdk');
    rpcModule = sdk.rpc;
  }
  return rpcModule;
}

export async function getSorobanServer() {
  const rpcMod = await getRpcModule();
  return new rpcMod.Server(STELLAR_NETWORK.rpcUrl);
}

function formatScVal(val: xdr.ScVal): string {
  try {
    const name = val.switch().name;
    switch (name) {
      case 'scvBool':
        return val.b() ? 'true' : 'false';
      case 'scvVoid':
        return 'void';
      case 'scvU32':
        return val.u32().toString();
      case 'scvI32':
        return val.i32().toString();
      case 'scvU64':
        return val.u64().toString();
      case 'scvI64':
        return val.i64().toString();
      case 'scvU128':
        return val.u128().toString();
      case 'scvI128':
        return val.i128().toString();
      case 'scvU256':
        return val.u256().toString();
      case 'scvI256':
        return val.i256().toString();
      case 'scvBytes':
        return Buffer.from(val.bytes()).toString('hex');
      case 'scvString':
        return val.str().toString();
      case 'scvSymbol':
        return val.sym().toString();
      default:
        return val.toXDR('base64');
    }
  } catch {
    return val.toXDR('base64');
  }
}

export async function simulateStellarTransaction(
  tx: import('@stellar/stellar-sdk').Transaction,
): Promise<SimulationResult> {
  try {
    const rpcMod = await getRpcModule();
    const soroban = await getSorobanServer();

    const simulated = await soroban.simulateTransaction(tx);

    if (rpcMod.Api.isSimulationError(simulated)) {
      return {
        ok: false,
        error: simulated.error,
        isNetworkError: false,
      };
    }

    if (rpcMod.Api.isSimulationSuccess(simulated) || rpcMod.Api.isSimulationRestore(simulated)) {
      const resultVal = simulated.result?.retval ?? null;
      return {
        ok: true,
        minResourceFee: simulated.minResourceFee,
        predictedFeeStroops: simulated.minResourceFee,
        returnValue: resultVal ? formatScVal(resultVal) : null,
        eventCount: simulated.events?.length ?? 0,
        transactionData: simulated.transactionData.build().toXDR('base64'),
        latestLedger: simulated.latestLedger,
      };
    }

    return {
      ok: false,
      error: 'Unexpected simulation response',
      isNetworkError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Simulation failed';
    const isNetworkError =
      message.includes('fetch') ||
      message.includes('network') ||
      message.includes('ECONNREFUSED') ||
      message.includes('timeout');
    return {
      ok: false,
      error: message,
      isNetworkError,
    };
  }
}

export async function buildAnnounceTransaction(
  senderAddress: string,
  stealthAddress: string,
  ephemeralPubKey: Uint8Array,
  viewTag: number,
  schemeId: number,
  contractAddress: string,
): Promise<import('@stellar/stellar-sdk').Transaction> {
  const { Contract, nativeToScVal, Address } = await import('@stellar/stellar-sdk');
  const horizonUrl = STELLAR_NETWORK.horizonUrl;
  const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

  const accountRes = await fetch(`${horizonUrl}/accounts/${senderAddress}`);
  if (!accountRes.ok) throw new Error('Failed to load sender account');
  const accountData = await accountRes.json();
  const sourceAccount = new Account(senderAddress, accountData.sequence);

  const contract = new Contract(contractAddress);

  return new TransactionBuilder(sourceAccount, { fee: '100', networkPassphrase })
    .addOperation(
      contract.call(
        'announce',
        nativeToScVal(schemeId, { type: 'u32' }),
        new Address(stealthAddress).toScVal(),
        xdr.ScVal.scvBytes(Buffer.from(ephemeralPubKey)),
        xdr.ScVal.scvBytes(Buffer.from([viewTag])),
      ),
    )
    .setTimeout(30)
    .build();
}
