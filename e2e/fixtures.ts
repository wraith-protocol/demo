import { test as base } from '@playwright/test';
import { xdr, Address, nativeToScVal } from '@stellar/stellar-sdk';

export interface FreighterMockConfig {
  isConnected: boolean;
  address: string | null;
  signedMessage: string | null; // base64
  signedTxXdr: string | null;
  shouldFailConnect?: boolean;
  shouldFailSignMessage?: boolean;
  shouldFailSignTx?: boolean;
  autoConnect?: boolean;
  network?: 'PUBLIC' | 'TESTNET' | 'FUTURENET';
  networkPassphrase?: string;
}

export interface SenderTrustline {
  asset_code: string;
  asset_issuer: string;
  balance: string;
}

export interface HorizonMockConfig {
  accountExists: boolean;
  accountBalance: string;
  txSuccess: boolean;
  txHash?: string;
  txErrorCode?: string;
  sorobanEvents?: Array<{
    schemeId: number;
    stealthAddress: string;
    caller: string;
    ephemeralPubKey: Uint8Array;
    viewTag: number;
  }>;
  sorobanSimulateSuccess?: boolean;
  sorobanSimulateError?: string;
  sorobanTxStatus?: string;
  address?: string;
  // Sender-only `/accounts/*` overrides. When set to a retryable status
  // (503/502/504/429/408) the fetch retries until `withRetry` exhausts and the
  // UI surfaces `RetryExhaustedError`; this is how the failure matrix drives
  // the "RPC exhausted" axis without simulating clock drift.
  accountFetchStatus?: number;
  // Extra trustlines to attach to the sender payload; required so a non-XLM
  // asset like USDC becomes selectable in the AssetPicker.
  senderTrustlines?: SenderTrustline[];
}

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

const DEFAULT_WALLET_ADDRESS = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';

export const test = base.extend<{
  freighter: {
    mock: (config: Partial<FreighterMockConfig>) => Promise<void>;
  };
  horizon: {
    mock: (config: Partial<HorizonMockConfig>) => Promise<void>;
  };
  session: {
    // Deterministically fires the App's IdleLock so a spec does not have to
    // wait APP_IDLE_TIMEOUT_MS. Wired via a dev/test-only window hook in
    // App.tsx; the hook is stripped from production builds by Vite.
    expire: () => Promise<void>;
  };
}>({
  freighter: async ({ page }, use) => {
    const mock = async (config: Partial<FreighterMockConfig>) => {
      await page.addInitScript((cfg) => {
        (window as any).freighterMock = {
          isConnected: async () => ({ isConnected: cfg.isConnected !== false }),
          authorized: false,
          getAddress: async function () {
            if (cfg.shouldFailConnect) {
              return { address: '', error: 'Access denied' };
            }
            if (this.authorized || cfg.autoConnect) {
              return {
                address: cfg.address || 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX',
              };
            }
            return { address: '' };
          },
          requestAccess: async function () {
            if (cfg.shouldFailConnect) {
              throw new Error('User rejected connection');
            }
            this.authorized = true;
            return {
              address: cfg.address || 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX',
            };
          },
          signMessage: async (message: string) => {
            if (cfg.shouldFailSignMessage) {
              throw new Error('User rejected signature');
            }
            const defaultSig =
              'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
            return {
              signedMessage: cfg.signedMessage || defaultSig,
            };
          },
          signTransaction: async (xdrString: string) => {
            if (cfg.shouldFailSignTx) {
              throw new Error('User rejected transaction signing');
            }
            return {
              signedTxXdr: cfg.signedTxXdr || xdrString,
            };
          },
          // The wallet context calls getNetworkDetails from both the mount
          // watcher and the connect callback; the previous mock omitted it, so
          // freighterPassphrase never populated and the wrong-network path
          // could not be exercised.
          getNetworkDetails: async () => ({
            network: cfg.network ?? 'TESTNET',
            networkPassphrase: cfg.networkPassphrase ?? 'Test SDF Network ; September 2015',
          }),
          // Reject silent session restore so specs always drive the wallet
          // through the explicit "Connect Freighter" click (matches the
          // existing spec pattern).
          isAllowed: async () => ({ isAllowed: false }),
          // No-op watcher: specs drive state transitions directly, so a real
          // 3s polling loop would just add flake.
          WatchWalletChanges: class {
            constructor(_intervalMs: number) {}
            watch(_cb: unknown) {}
            stop() {}
          },
        };
      }, config);
    };
    await use({ mock });
  },

  horizon: async ({ page }, use) => {
    const mock = async (config: Partial<HorizonMockConfig>) => {
      const mergedConfig = {
        accountExists: true,
        accountBalance: '1000',
        txSuccess: true,
        txHash: 'mocked_tx_hash_1234567890',
        txErrorCode: '',
        sorobanEvents: [],
        sorobanSimulateSuccess: true,
        sorobanSimulateError: '',
        sorobanTxStatus: 'SUCCESS',
        ...config,
      };

      // Set up in-page variables for Soroban Mock Server and Scanning
      await page.addInitScript((cfg) => {
        (window as any).sorobanServerMock = {
          getAccount: async (address: string) => {
            if (
              address !== 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX' &&
              address !== cfg.address &&
              !cfg.accountExists
            ) {
              return Promise.reject({
                code: 404,
                message: `Account not found: ${address}`,
              });
            }
            return {
              accountId: () => address,
              sequenceNumber: () => '1',
            };
          },
          simulateTransaction: async (tx: any) => {
            if (!cfg.sorobanSimulateSuccess) {
              return { error: cfg.sorobanSimulateError || 'Simulation failed' };
            }
            return {
              results: [{ auth: [], retval: { type: 'void' } }],
              minResourceFee: '100',
              transactionData: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
            };
          },
          sendTransaction: async (tx: any) => {
            return {
              status: 'PENDING',
              hash: cfg.txHash || 'mocked_soroban_tx_hash',
            };
          },
          getTransaction: async (hash: string) => {
            return {
              status: cfg.sorobanTxStatus || 'SUCCESS',
              hash,
            };
          },
        };

        (window as any).scanAnnouncementsMock = (
          announcements: any[],
          viewingKey: any,
          spendingPubKey: any,
          spendingScalar: any,
        ) => {
          if (cfg.sorobanEvents && cfg.sorobanEvents.length > 0) {
            return cfg.sorobanEvents.map((e) => ({
              stealthAddress: e.stealthAddress,
              stealthPrivateScalar: 123456789n,
              stealthPubKeyBytes: new Uint8Array([
                23, 255, 173, 128, 104, 220, 13, 233, 147, 93, 54, 99, 111, 58, 209, 181, 222, 109,
                227, 65, 59, 18, 56, 142, 69, 59, 5, 242, 164, 193, 211, 219,
              ]),
            }));
          }
          return [];
        };
      }, mergedConfig);

      // Route Horizon accounts calls
      await page.route('https://horizon-testnet.stellar.org/accounts/*', async (route) => {
        const url = route.request().url();
        const address = url.split('/accounts/').pop()?.split('?')[0] || '';

        const isSender = address === DEFAULT_WALLET_ADDRESS || address === config.address;

        // Retryable-status branch for the "RPC exhausted" failure axis. Only
        // applies to the sender lookup; checkAssetTrustline hits the stealth
        // address and must resolve normally so trustline-missing stays
        // observable regardless of this override.
        if (
          isSender &&
          typeof mergedConfig.accountFetchStatus === 'number' &&
          mergedConfig.accountFetchStatus >= 400
        ) {
          await route.fulfill({
            status: mergedConfig.accountFetchStatus,
            contentType: 'application/json',
            body: JSON.stringify({
              title: 'Service Unavailable',
              status: mergedConfig.accountFetchStatus,
            }),
          });
          return;
        }

        if (isSender || mergedConfig.accountExists) {
          const balances: Array<{
            asset_type: string;
            asset_code?: string;
            asset_issuer?: string;
            balance: string;
          }> = [{ asset_type: 'native', balance: mergedConfig.accountBalance }];

          // Extra trustlines only apply to the sender payload; stealth-address
          // lookups intentionally stay native-only so `checkAssetTrustline`
          // sees the "no trustline for this asset" state.
          if (isSender && mergedConfig.senderTrustlines) {
            for (const tl of mergedConfig.senderTrustlines) {
              balances.push({
                asset_type: 'credit_alphanum4',
                asset_code: tl.asset_code,
                asset_issuer: tl.asset_issuer,
                balance: tl.balance,
              });
            }
          }

          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: address,
              sequence: '1',
              balances,
              subentry_count: 0,
            }),
          });
        } else {
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({
              title: 'Resource Missing',
              status: 404,
            }),
          });
        }
      });

      // Route Horizon transactions submission
      await page.route('https://horizon-testnet.stellar.org/transactions', async (route) => {
        if (route.request().method() === 'POST') {
          if (mergedConfig.txSuccess) {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                hash: mergedConfig.txHash,
                ledger: 100,
              }),
            });
          } else {
            await route.fulfill({
              status: 400,
              contentType: 'application/json',
              body: JSON.stringify({
                title: 'Transaction Failed',
                extras: {
                  result_codes: {
                    transaction: mergedConfig.txErrorCode || 'tx_failed',
                  },
                },
              }),
            });
          }
        } else {
          await route.continue();
        }
      });

      // Map mock events from Node config to base64 JSON-RPC structure
      const base64Events = (mergedConfig.sorobanEvents || []).map((e) => {
        const schemeIdScVal = nativeToScVal(e.schemeId, { type: 'u32' });
        const stealthScVal = new Address(e.stealthAddress).toScVal();
        const valueVec = [
          new Address(e.caller).toScVal(),
          xdr.ScVal.scvBytes(Buffer.from(e.ephemeralPubKey)),
          xdr.ScVal.scvBytes(Buffer.from([e.viewTag])),
        ];
        const valueScVal = xdr.ScVal.scvVec(valueVec);

        return {
          topic: [
            xdr.ScVal.scvSymbol('announce').toXDR('base64'),
            schemeIdScVal.toXDR('base64'),
            stealthScVal.toXDR('base64'),
          ],
          value: valueScVal.toXDR('base64'),
          contractId: 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL',
        };
      });

      // Route Soroban RPC calls (specifically for getEvents)
      await page.route('https://soroban-testnet.stellar.org', async (route) => {
        if (route.request().method() === 'POST') {
          const body = route.request().postDataJSON();
          const id = body?.id || 1;

          if (body?.method === 'getEvents') {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                jsonrpc: '2.0',
                id,
                result: {
                  events: base64Events,
                },
              }),
            });
          } else {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ jsonrpc: '2.0', id, result: {} }),
            });
          }
        } else {
          await route.continue();
        }
      });
    };

    await use({ mock });
  },

  session: async ({ page }, use) => {
    await use({
      expire: async () => {
        // Falls back to a no-op when the hook is absent (e.g. production
        // build) so a mis-configured spec fails on its next assertion with
        // an actionable message rather than a cryptic evaluate-time error.
        await page.evaluate(() => {
          const hook = (window as unknown as { __wraithForceIdleLock?: () => void })
            .__wraithForceIdleLock;
          if (typeof hook === 'function') hook();
        });
      },
    });
  },
});

// TESTNET_PASSPHRASE is exported so specs can construct wrong-network scenarios
// against the canonical value the app compares against.
export { TESTNET_PASSPHRASE };

export { expect } from '@playwright/test';
