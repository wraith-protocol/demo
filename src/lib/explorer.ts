import { horizenTestnet, STELLAR_NETWORK, SOLANA_NETWORK, CKB_NETWORK } from '@/config';

const HORIZEN_EXPLORER = horizenTestnet.blockExplorers.default.url;
const STELLAR_EXPLORER = STELLAR_NETWORK.explorerUrl;
const SOLANA_EXPLORER = SOLANA_NETWORK.explorerUrl;
const CKB_EXPLORER = CKB_NETWORK.explorerUrl;

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

export function solanaTxUrl(hash: string) {
  return `${SOLANA_EXPLORER}/tx/${hash}?cluster=devnet`;
}

export function solanaAddrUrl(addr: string) {
  return `${SOLANA_EXPLORER}/address/${addr}?cluster=devnet`;
}

export function ckbTxUrl(hash: string) {
  return `${CKB_EXPLORER}/transaction/${hash}`;
}

export function ckbAddrUrl(addr: string) {
  return `${CKB_EXPLORER}/address/${addr}`;
}
