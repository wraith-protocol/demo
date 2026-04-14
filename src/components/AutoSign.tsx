import { useEffect, useRef, useState } from 'react';
import { useAccount, useConnectorClient, useSignMessage } from 'wagmi';
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

export function AutoSign() {
  const { chain } = useChain();

  return (
    <>
      {chain === 'horizen' && <HorizenAutoSign />}
      {chain === 'stellar' && <StellarAutoSign />}
    </>
  );
}
