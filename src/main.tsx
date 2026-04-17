import { Buffer } from 'buffer';
(window as unknown as Record<string, unknown>).Buffer = Buffer;

import { StrictMode, useState, useMemo, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import { clusterApiUrl } from '@solana/web3.js';
import { ccc } from '@ckb-ccc/connector-react';
import { ChainProvider } from '@/context/ChainContext';
import { StealthKeysProvider } from '@/context/StealthKeysContext';
import { StellarWalletProvider } from '@/context/StellarWalletContext';
import { wagmiConfig } from '@/config';
import { App } from './App';
import '@rainbow-me/rainbowkit/styles.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import './index.css';

function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const solanaEndpoint = useMemo(() => clusterApiUrl('devnet'), []);
  const solanaWallets = useMemo(() => [new PhantomWalletAdapter()], []);
  const ckbClient = useMemo(() => new ccc.ClientPublicTestnet(), []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: '#c6c6c7',
            accentColorForeground: '#0e0e0e',
            borderRadius: 'none',
            fontStack: 'system',
          })}
        >
          <ConnectionProvider endpoint={solanaEndpoint}>
            <SolanaWalletProvider wallets={solanaWallets} autoConnect>
              <WalletModalProvider>
                <ccc.Provider
                  defaultClient={ckbClient}
                  connectorProps={{
                    style: {
                      '--background': '#141414',
                      '--divider': 'rgba(255, 255, 255, 0.1)',
                      color: '#e6e1e5',
                    } as CSSProperties,
                  }}
                >
                  <ChainProvider>
                    <StellarWalletProvider>
                      <StealthKeysProvider>{children}</StealthKeysProvider>
                    </StellarWalletProvider>
                  </ChainProvider>
                </ccc.Provider>
              </WalletModalProvider>
            </SolanaWalletProvider>
          </ConnectionProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Providers>
        <App />
      </Providers>
    </BrowserRouter>
  </StrictMode>,
);
