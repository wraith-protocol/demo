import { useEffect, useRef, useState } from 'react';
import { useAccount, useConnectorClient, useSignMessage } from 'wagmi';
import { useWallet } from '@solana/wallet-adapter-react';
import { ccc } from '@ckb-ccc/connector-react';
import {
  deriveStealthKeys,
  encodeStealthMetaAddress,
  STEALTH_SIGNING_MESSAGE,
} from '@wraith-protocol/sdk/chains/evm';
import type { HexString } from '@wraith-protocol/sdk/chains/evm';
import {
  deriveStealthKeys as deriveStellarKeys,
  encodeStealthMetaAddress as encodeStellarMeta,
  STEALTH_SIGNING_MESSAGE as STELLAR_SIGNING_MESSAGE,
} from '@wraith-protocol/sdk/chains/stellar';
import {
  deriveStealthKeys as deriveSolanaKeys,
  encodeStealthMetaAddress as encodeSolanaMeta,
  STEALTH_SIGNING_MESSAGE as SOLANA_SIGNING_MESSAGE,
} from '@wraith-protocol/sdk/chains/solana';
import {
  deriveStealthKeys as deriveCkbKeys,
  encodeStealthMetaAddress as encodeCkbMeta,
  STEALTH_SIGNING_MESSAGE as CKB_SIGNING_MESSAGE,
} from '@wraith-protocol/sdk/chains/ckb';
import type { HexString as CkbHexString } from '@wraith-protocol/sdk/chains/ckb';
import { useStealthKeys } from '@/context/StealthKeysContext';
import { useStellarWallet } from '@/context/StellarWalletContext';
import { useChain } from '@/context/ChainContext';

function HorizenAutoSign() {
  const { isConnected, address, connector } = useAccount();
  const { data: connectorClient } = useConnectorClient();
  const { signMessageAsync } = useSignMessage();
  const { evmKeys, setEvmKeys, setEvmMetaAddress, clearEvm } = useStealthKeys();
  const prompted = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const isLoading = useRef(false);

  useEffect(() => {
    if (isConnected && connector && connectorClient) {
      const timer = setTimeout(() => setReady(true), 500);
      return () => clearTimeout(timer);
    }
    setReady(false);
  }, [isConnected, connector, connectorClient]);

  useEffect(() => {
    if (!ready || !address) return;
    if (evmKeys) return;
    if (isLoading.current) return;
    if (prompted.current === address) return;

    prompted.current = address;
    isLoading.current = true;

    (async () => {
      try {
        const signature = await signMessageAsync({ message: STEALTH_SIGNING_MESSAGE });
        const keys = deriveStealthKeys(signature as HexString);
        const meta = encodeStealthMetaAddress(keys.spendingPubKey, keys.viewingPubKey);
        setEvmKeys(keys);
        setEvmMetaAddress(meta);
      } catch {
        // User rejected or error
      } finally {
        isLoading.current = false;
      }
    })();
  }, [ready, address, evmKeys, signMessageAsync, setEvmKeys, setEvmMetaAddress]);

  useEffect(() => {
    if (!isConnected) {
      prompted.current = null;
      setReady(false);
      clearEvm();
    }
  }, [isConnected, clearEvm]);

  return null;
}

function StellarAutoSign() {
  const { isConnected, address, signMessage } = useStellarWallet();
  const { stellarKeys, setStellarKeys, setStellarMetaAddress, clearStellar } = useStealthKeys();
  const prompted = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const isLoading = useRef(false);

  useEffect(() => {
    if (isConnected && address) {
      const timer = setTimeout(() => setReady(true), 500);
      return () => clearTimeout(timer);
    }
    setReady(false);
  }, [isConnected, address]);

  useEffect(() => {
    if (!ready || !address) return;
    if (stellarKeys) return;
    if (isLoading.current) return;
    if (prompted.current === address) return;

    prompted.current = address;
    isLoading.current = true;

    (async () => {
      try {
        const signature = await signMessage(STELLAR_SIGNING_MESSAGE);
        const keys = deriveStellarKeys(signature);
        const meta = encodeStellarMeta(keys.spendingPubKey, keys.viewingPubKey);
        setStellarKeys(keys);
        setStellarMetaAddress(meta);
      } catch {
        // User rejected or error
      } finally {
        isLoading.current = false;
      }
    })();
  }, [ready, address, stellarKeys, signMessage, setStellarKeys, setStellarMetaAddress]);

  useEffect(() => {
    if (!isConnected) {
      prompted.current = null;
      setReady(false);
      clearStellar();
    }
  }, [isConnected, clearStellar]);

  return null;
}

function SolanaAutoSign() {
  const { connected, publicKey, signMessage } = useWallet();
  const { solanaKeys, setSolanaKeys, setSolanaMetaAddress, clearSolana } = useStealthKeys();
  const prompted = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const isLoading = useRef(false);

  useEffect(() => {
    if (connected && publicKey) {
      const timer = setTimeout(() => setReady(true), 500);
      return () => clearTimeout(timer);
    }
    setReady(false);
  }, [connected, publicKey]);

  useEffect(() => {
    if (!ready || !publicKey || !signMessage) return;
    if (solanaKeys) return;
    if (isLoading.current) return;
    const addr = publicKey.toBase58();
    if (prompted.current === addr) return;

    prompted.current = addr;
    isLoading.current = true;

    (async () => {
      try {
        const msgBytes = new TextEncoder().encode(SOLANA_SIGNING_MESSAGE);
        const signature = await signMessage(msgBytes);
        const keys = deriveSolanaKeys(signature);
        const meta = encodeSolanaMeta(keys.spendingPubKey, keys.viewingPubKey);
        setSolanaKeys(keys);
        setSolanaMetaAddress(meta);
      } catch {
        // User rejected
      } finally {
        isLoading.current = false;
      }
    })();
  }, [ready, publicKey, solanaKeys, signMessage, setSolanaKeys, setSolanaMetaAddress]);

  useEffect(() => {
    if (!connected) {
      prompted.current = null;
      setReady(false);
      clearSolana();
    }
  }, [connected, clearSolana]);

  return null;
}

function CkbAutoSign() {
  const { wallet } = ccc.useCcc();
  const signer = ccc.useSigner();
  const { ckbKeys, setCkbKeys, setCkbMetaAddress, clearCkb } = useStealthKeys();
  const prompted = useRef(false);
  const [ready, setReady] = useState(false);
  const isLoading = useRef(false);

  useEffect(() => {
    if (wallet && signer) {
      const timer = setTimeout(() => setReady(true), 500);
      return () => clearTimeout(timer);
    }
    setReady(false);
  }, [wallet, signer]);

  useEffect(() => {
    if (!ready || !signer) return;
    if (ckbKeys) return;
    if (isLoading.current) return;
    if (prompted.current) return;

    prompted.current = true;
    isLoading.current = true;

    (async () => {
      try {
        const sig = await (signer as any).signMessageRaw(CKB_SIGNING_MESSAGE);
        const sigStr = typeof sig === 'string' ? sig : `0x${Buffer.from(sig).toString('hex')}`;
        const sigHex = sigStr.startsWith('0x') ? sigStr : `0x${sigStr}`;
        const derived = deriveCkbKeys(sigHex as CkbHexString);
        const meta = encodeCkbMeta(derived.spendingPubKey, derived.viewingPubKey);
        setCkbKeys(derived);
        setCkbMetaAddress(meta);
      } catch {
        // User rejected
      } finally {
        isLoading.current = false;
      }
    })();
  }, [ready, signer, ckbKeys, setCkbKeys, setCkbMetaAddress]);

  useEffect(() => {
    if (!wallet) {
      prompted.current = false;
      setReady(false);
      clearCkb();
    }
  }, [wallet, clearCkb]);

  return null;
}

export function AutoSign() {
  const { chain } = useChain();

  return (
    <>
      {chain === 'horizen' && <HorizenAutoSign />}
      {chain === 'stellar' && <StellarAutoSign />}
      {chain === 'solana' && <SolanaAutoSign />}
      {chain === 'ckb' && <CkbAutoSign />}
    </>
  );
}
