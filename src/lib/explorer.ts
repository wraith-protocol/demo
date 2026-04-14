import { horizenTestnet, STELLAR_NETWORK } from '@/config';

const HORIZEN_EXPLORER = horizenTestnet.blockExplorers.default.url;
const STELLAR_EXPLORER = STELLAR_NETWORK.explorerUrl;

export function horizenTxUrl(hash: string) {
  return `${HORIZEN_EXPLORER}/tx/${hash}`;
}

export function horizenAddrUrl(addr: string) {
  return `${HORIZEN_EXPLORER}/address/${addr}`;
}

export function stellarTxUrl(hash: string) {
  return `${STELLAR_EXPLORER}/tx/${hash}`;
}

export function stellarAddrUrl(addr: string) {
  return `${STELLAR_EXPLORER}/account/${addr}`;
}
