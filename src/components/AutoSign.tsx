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
import { useChain } from '@/context/ChainContext';
import { STELLAR_NETWORK } from '@/config';

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
        // User rejected or error — don't block
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
  const { stellarKeys, setStellarKeys, setStellarMetaAddress } = useStealthKeys();
  const prompted = useRef<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const isLoading = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const freighter = await import('@stellar/freighter-api');
        const { isConnected } = await freighter.isConnected();
        if (isConnected) {
          const { address } = await freighter.getAddress();
          if (address) {
            setWalletAddress(address);
            const timer = setTimeout(() => setReady(true), 500);
            return () => clearTimeout(timer);
          }
        }
      } catch {
        // Freighter not available
      }
    })();
  }, []);

  useEffect(() => {
    if (!ready || !walletAddress) return;
    if (stellarKeys) return;
    if (isLoading.current) return;
    if (prompted.current === walletAddress) return;

    prompted.current = walletAddress;
    isLoading.current = true;

    (async () => {
      try {
        const freighter = await import('@stellar/freighter-api');
        const { signedMessage } = await freighter.signMessage(STELLAR_SIGNING_MESSAGE, {
          address: walletAddress,
          networkPassphrase: STELLAR_NETWORK.networkPassphrase,
        });

        const raw = signedMessage as unknown as string;
        if (!raw) return;
        const binaryString = atob(raw);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const keys = deriveStellarKeys(bytes);
        const meta = encodeStellarMeta(keys.spendingPubKey, keys.viewingPubKey);
        setStellarKeys(keys);
        setStellarMetaAddress(meta);
      } catch {
        // User rejected or error
      } finally {
        isLoading.current = false;
      }
    })();
  }, [ready, walletAddress, stellarKeys, setStellarKeys, setStellarMetaAddress]);

  return null;
}

export function AutoSign() {
  const { chain } = useChain();

  if (chain === 'stellar') {
    return <StellarAutoSign />;
  }

  return <HorizenAutoSign />;
}
