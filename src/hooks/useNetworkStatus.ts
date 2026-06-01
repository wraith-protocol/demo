import { useState, useEffect } from 'react';
import { useChainId, useAccount } from 'wagmi';
import { useWallet } from '@solana/wallet-adapter-react';
import { useChain } from '@/context/ChainContext';
import { NETWORK_EXPECTATIONS } from '@/config/networks';
import { SOLANA_NETWORK, CKB_NETWORK } from '@/config';
import type { NetworkStatus } from '@/config/networks';

const SOLANA_GENESIS: Record<string, string> = {
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWox8kWrB',
  testnet: '4uhcVJyU9pJkvQyS88uRDisJWn6gQq4mM8bM3BDqN2M',
};

export function useNetworkStatus() {
  const { chain } = useChain();
  const expected = NETWORK_EXPECTATIONS[chain];

  const [status, setStatus] = useState<NetworkStatus>('unknown');
  const [detectedNetwork, setDetectedNetwork] = useState<string | null>(null);

  const wagmiChainId = useChainId();
  const { isConnected: isEvmConnected } = useAccount();
  const { connected: isSolConnected } = useWallet();

  useEffect(() => {
    let cancelled = false;

    const detect = async () => {
      switch (chain) {
        case 'horizen': {
          if (!isEvmConnected) {
            if (!cancelled) {
              setStatus('unknown');
              setDetectedNetwork(null);
            }
            return;
          }
          if (wagmiChainId === expected.expectedChainId) {
            if (!cancelled) {
              setStatus('correct');
              setDetectedNetwork(expected.expectedNetwork);
            }
          } else if (wagmiChainId === 1 || wagmiChainId === 7332) {
            if (!cancelled) {
              setStatus('mainnet');
              setDetectedNetwork(wagmiChainId === 1 ? 'Ethereum Mainnet' : 'Horizen EON Mainnet');
            }
          } else {
            if (!cancelled) {
              setStatus('wrong-network');
              setDetectedNetwork(`Chain ID ${wagmiChainId}`);
            }
          }
          break;
        }

        case 'stellar': {
          try {
            const freighter = await import('@stellar/freighter-api');
            const { isConnected } = await freighter.isConnected();
            if (!isConnected) {
              if (!cancelled) {
                setStatus('unknown');
                setDetectedNetwork(null);
              }
              return;
            }
            const networkDetails = await freighter.getNetwork();
            const net = networkDetails.network;
            if (!cancelled) {
              setDetectedNetwork(net);
              if (net === 'TESTNET') {
                setStatus('correct');
              } else if (net === 'PUBLIC') {
                setStatus('mainnet');
              } else {
                setStatus('wrong-network');
              }
            }
          } catch {
            if (!cancelled) {
              setStatus('unknown');
              setDetectedNetwork(null);
            }
          }
          break;
        }

        case 'solana': {
          if (!isSolConnected) {
            if (!cancelled) {
              setStatus('unknown');
              setDetectedNetwork(null);
            }
            return;
          }
          try {
            const { Connection } = await import('@solana/web3.js');
            const connection = new Connection(SOLANA_NETWORK.rpcUrl, 'confirmed');
            const genesisHash = await connection.getGenesisHash();
            if (!cancelled) {
              setDetectedNetwork(genesisHash);
              if (genesisHash === SOLANA_GENESIS.devnet) {
                setStatus('correct');
              } else if (genesisHash === SOLANA_GENESIS['mainnet-beta']) {
                setStatus('mainnet');
              } else {
                setStatus('wrong-network');
              }
            }
          } catch {
            if (!cancelled) {
              setStatus('unknown');
              setDetectedNetwork(null);
            }
          }
          break;
        }

        case 'ckb': {
          try {
            const res = await fetch(CKB_NETWORK.rpcUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: 1,
                jsonrpc: '2.0',
                method: 'get_blockchain_info',
                params: [],
              }),
            });
            const data = await res.json();
            const chainName = data.result?.chain;
            if (!cancelled) {
              setDetectedNetwork(chainName || 'unknown');
              if (chainName === 'testnet' || chainName === 'pudge') {
                setStatus('correct');
              } else if (chainName === 'mainnet' || chainName === 'ckb') {
                setStatus('mainnet');
              } else {
                setStatus('wrong-network');
              }
            }
          } catch {
            if (!cancelled) {
              setStatus('unknown');
              setDetectedNetwork(null);
            }
          }
          break;
        }
      }
    };

    detect();

    const interval = setInterval(() => {
      if (!cancelled) detect();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [chain, wagmiChainId, isEvmConnected, isSolConnected, expected.expectedChainId]);

  return {
    status,
    expectedNetwork: expected.expectedNetwork,
    detectedNetwork,
    switchInstructions: expected.switchInstructions,
    isWrong: status === 'wrong-network',
    isMainnet: status === 'mainnet',
    isUnknown: status === 'unknown',
    isDisconnected: status === 'disconnected',
    isCorrect: status === 'correct',
    shouldDisable: status === 'wrong-network' || status === 'mainnet',
  };
}
