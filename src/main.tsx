import { Buffer } from 'buffer';
(window as unknown as Record<string, unknown>).Buffer = Buffer;

import { StrictMode, useState, useMemo, useEffect, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';

// Register service worker for notifications
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw/stellar-notification-sw.js', {
      type: 'module',
    }).catch((error) => {
      console.error('Service worker registration failed:', error);
    });
  });
}
import { BrowserRouter } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider, darkTheme, lightTheme } from '@rainbow-me/rainbowkit';
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
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
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
  const { theme } = useTheme();

  const rainbowKitTheme = useMemo(() => {
    const baseTheme = theme === 'dark' ? darkTheme : lightTheme;
    return baseTheme({
      accentColor: theme === 'dark' ? '#c6c6c7' : '#1a1a1a',
      accentColorForeground: theme === 'dark' ? '#0e0e0e' : '#ffffff',
      borderRadius: 'none',
      fontStack: 'system',
    });
  }, [theme]);

  return (
    <ThemeProvider>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider theme={rainbowKitTheme}>
            <ConnectionProvider endpoint={solanaEndpoint}>
              <SolanaWalletProvider wallets={solanaWallets} autoConnect>
                <WalletModalProvider>
                  <ccc.Provider
                    defaultClient={ckbClient}
                    connectorProps={{
                      style: {
                        '--background': theme === 'dark' ? '#141414' : '#f5f5f5',
                        '--divider': theme === 'dark' ? '#444444' : '#e0e0e0',
                        '--btn-primary': theme === 'dark' ? '#c6c6c7' : '#1a1a1a',
                        '--btn-primary-hover': theme === 'dark' ? '#e6e1e5' : '#4a4a4a',
                        '--btn-secondary': theme === 'dark' ? '#0e0e0e' : '#ffffff',
                        '--wallet-selected': theme === 'dark' ? '#1a1a1a' : '#fafafa',
                        color: theme === 'dark' ? '#e6e1e5' : '#1a1a1a',
                        borderRadius: '0px',
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
    </ThemeProvider>
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
