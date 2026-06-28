import {
  Account,
  Address,
  Contract,
  TransactionBuilder,
  humanizeEvents,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { generateStealthAddress, decodeStealthMetaAddress, SCHEME_ID } from '@wraith-protocol/sdk/chains/stellar';
import { STELLAR_NETWORK } from '@/config';
import { fetchWithRetry, withRetry, type RetryOptions } from '@/lib/stellar/retry';

const ANNOUNCER_CONTRACT = 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL';
const CONTRACT_ERROR_PATTERN = /Error\(Contract, #(\d+)\)/;

export type StellarSendSimulationState =
  | { status: 'idle'; error: ''; fee: null; returnValue: null; events: [] }
  | {
      status: 'loading';
      error: '';
      fee: null;
      returnValue: null;
      events: [];
    }
  | {
      status: 'success';
      error: '';
      fee: string;
      returnValue: string;
      events: string[];
    }
  | {
      status: 'error';
      error: string;
      fee: null;
      returnValue: null;
      events: [];
    };

export const emptyStellarSendSimulation = (): StellarSendSimulationState => ({
  status: 'idle',
  error: '',
  fee: null,
  returnValue: null,
  events: [],
});

function stringifyNativeValue(value: unknown) {
  if (value === null) return 'null';
  if (value === undefined) return 'void';
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function decodeSimulationError(message: string) {
  const contractMatch = message.match(CONTRACT_ERROR_PATTERN);
  if (contractMatch) {
    return `Soroban contract error #${contractMatch[1]}`;
  }

  return message.replace(/^Error:\s*/i, '');
}

export function formatPredictedFee(minResourceFee: string) {
  const stroops = Number(minResourceFee);
  if (!Number.isFinite(stroops)) return minResourceFee;
  const xlm = stroops / 10_000_000;
  return `${stroops} stroops (${xlm.toFixed(7).replace(/\.?0+$/, '')} XLM)`;
}

function formatPredictedEvents(events: ReturnType<typeof humanizeEvents>) {
  return events.map((event) => {
    const contractId = event.contractId ? `${event.contractId}: ` : '';
    const topics = event.topics.map((topic) => stringifyNativeValue(topic)).join(', ');
    const data = stringifyNativeValue(event.data);
    return `${contractId}${topics ? `[${topics}] ` : ''}${data}`;
  });
}

export async function simulateStellarSendAnnouncement(
  params: { address: string; recipient: string },
  opts?: Pick<RetryOptions, 'signal' | 'onRetry'>,
) {
  const decoded = decodeStealthMetaAddress(params.recipient);
  const result = generateStealthAddress(decoded.spendingPubKey, decoded.viewingPubKey);

  const accountRes = await fetchWithRetry(
    `${STELLAR_NETWORK.horizonUrl}/accounts/${params.address}`,
    {},
    opts,
  );
  if (!accountRes.ok) throw new Error('Failed to load sender account');

  const accountData = (await accountRes.json()) as { sequence: string };
  const sourceAccount = new Account(params.address, accountData.sequence);
  const networkPassphrase = STELLAR_NETWORK.networkPassphrase;

  const announceTx = new TransactionBuilder(sourceAccount, {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(
      new Contract(ANNOUNCER_CONTRACT).call(
        'announce',
        nativeToScVal(SCHEME_ID, { type: 'u32' }),
        new Address(result.stealthAddress).toScVal(),
        xdr.ScVal.scvBytes(Buffer.from(result.ephemeralPubKey)),
        xdr.ScVal.scvBytes(Buffer.from([result.viewTag])),
      ),
    )
    .setTimeout(30)
    .build();

  const soroban = new rpc.Server(STELLAR_NETWORK.rpcUrl);
  const simulation = await withRetry(() => soroban.simulateTransaction(announceTx), opts);

  if ('error' in simulation) {
    throw new Error(decodeSimulationError(simulation.error));
  }

  const fee = formatPredictedFee(simulation.minResourceFee);
  const returnValue = simulation.result ? stringifyNativeValue(scValToNative(simulation.result.retval)) : 'void';
  const events = formatPredictedEvents(humanizeEvents(simulation.events));

  return {
    fee,
    returnValue,
    events,
  };
}
