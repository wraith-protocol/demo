import { test as base, expect } from './fixtures';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { SorobanDataBuilder, TransactionBuilder, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import bs58 from 'bs58';

export const FROZEN_TIME = new Date('2025-01-15T12:00:00.000Z');
export const MOCK_WALLET = 'GCDURJMLJBNVUVWXZ7UBXEIAEC4ONEWPWK6KDUUSDTUJJGXCSMBC2XHX';
export const MOCK_TX_HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
export const DEPOSIT_ID = 'ab'.repeat(32);
export const MOCK_EVM_ACCOUNT = '0x0000000000000000000000000000000000000001';
export const MOCK_EVM_SIGNING_ACCOUNT = '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf';
export const MOCK_EVM_TX_HASH = `0x${'ab'.repeat(32)}`;
export const RECIPIENT_EVM_META =
  'st:eth:0x031b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f024d4b6cd1361032ca9bd2aeb9d900aa4d45d9ead80ac9423374c451a7254d0766';
export const MOCK_SOLANA_PUBLIC_KEY = '7UkoxijRwsbq6QM4kFmVYSlZJzpcY/k2NsFGFKyHN9E=';
export const RECIPIENT_SOLANA_META =
  'st:sol:8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c8139770ea87d175f56a35466c34c7ecccb8d8a91b4ee37a25df60f5b8fc9b394';
export const MOCK_SOLANA_SIGNATURE = bs58.encode(new Uint8Array(64).fill(0xab));
export const RECIPIENT_META =
  'st:xlm:5a1922b5614eed2ef72ebad40abc5d014f7c27b6e1de5dc36976e9eec4cbe29e6b912a495f9f14513d54a00a7887f986d394a30a77239475caf211e8094b6cdb';

export type VisualTheme = 'light' | 'dark';
const DESKTOP_HEADER_BREAKPOINT = 1280;

export const visualMasks = {
  transactionHash: (page: Page) => page.locator('a[href*="/tx/"]'),
  vaultDepositId: (page: Page) => page.getByText(DEPOSIT_ID, { exact: true }),
};

export async function beginVisualCase(
  page: Page,
  testInfo: TestInfo,
  route: string,
  state: string,
  theme: VisualTheme,
) {
  const viewport = testInfo.project.name.replace(/^chromium-?/, '');
  testInfo.annotations.push({
    type: 'visual-state',
    description: `${route} | ${state} | ${viewport} | ${theme}`,
  });

  if (theme === 'dark') {
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
  }
}

export async function captureVisual(page: Page, name: string, masks: Locator[] = []) {
  const loadedFamilies = await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 14px Inter'),
      document.fonts.load('400 14px "Space Grotesk"'),
      document.fonts.load('400 14px "JetBrains Mono"'),
    ]);
    await document.fonts.ready;
    return [...document.fonts]
      .filter((font) => font.status === 'loaded')
      .map((font) => font.family.replace(/"/g, ''));
  });
  expect(new Set(loadedFamilies)).toEqual(new Set(['Inter', 'Space Grotesk', 'JetBrains Mono']));
  await expect(page).toHaveScreenshot(`${name}.png`, {
    animations: 'disabled',
    caret: 'hide',
    mask: masks,
    maskColor: '#ff00ff',
  });
}

export async function selectVisualChain(page: Page, chain: string) {
  let chainSelect = page.locator('select[aria-label="Chain"]:visible').first();
  if ((await chainSelect.count()) === 0) {
    const menuButton = page.getByRole('button', { name: 'Menu' });
    await menuButton.click();
    chainSelect = page.locator('select[aria-label="Chain"]:visible').first();
    await chainSelect.selectOption(chain);
    await menuButton.click();
    return;
  }
  await chainSelect.selectOption(chain);
}

export async function openVisualMobileMenu(page: Page) {
  if ((page.viewportSize()?.width ?? Infinity) < DESKTOP_HEADER_BREAKPOINT) {
    await page.getByRole('button', { name: 'Menu' }).click();
  }
}

export async function closeVisualMobileMenu(page: Page) {
  if ((page.viewportSize()?.width ?? Infinity) < DESKTOP_HEADER_BREAKPOINT) {
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(page.getByText('Privacy posture', { exact: true })).toBeHidden();
  }
}

export async function connectVisualWallet(page: Page, buttonName: string) {
  await openVisualMobileMenu(page);
  await page.getByRole('button', { name: buttonName }).click();
  await closeVisualMobileMenu(page);
}

export const test = base.extend<{ frozenEnvironment: void }>({
  frozenEnvironment: [
    async ({ page }, use) => {
      // Time: fix Date without freezing timers, so the app keeps running.
      await page.clock.setFixedTime(FROZEN_TIME);

      // Motion: the config sets reducedMotion; this is a second guarantee.
      await page.emulateMedia({ reducedMotion: 'reduce' });

      // Analytics is disabled in this fixture; fonts are served by the app.
      await page.route(/plausible\.io/, (route) =>
        route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
      );
      // Consent: pre-decline analytics so the cookie banner never renders.
      await page.addInitScript(() => {
        localStorage.setItem('wraith-telemetry-consent', 'declined');
        localStorage.setItem('wraith-theme', 'light');
      });
      await page.addInitScript(() => {
        const disableMotion = () => {
          const style = document.createElement('style');
          style.textContent =
            '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important;caret-color:transparent!important}';
          document.documentElement.append(style);
        };
        if (document.documentElement) disableMotion();
        else document.addEventListener('DOMContentLoaded', disableMotion, { once: true });
      });
      // Network: abort every non-local request so nothing external can stall the load event.
      await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());

      // Randomness: seeded PRNG so ephemeral keys (and so stealth addresses) repeat.
      await page.addInitScript(() => {
        let s = 123456789;
        const next = () => {
          s = (s * 1664525 + 1013904223) >>> 0;
          return s & 0xff;
        };
        const original = crypto.getRandomValues.bind(crypto);
        crypto.getRandomValues = (<T extends ArrayBufferView | null>(arr: T): T => {
          if (arr instanceof Uint8Array) {
            for (let i = 0; i < arr.length; i += 1) arr[i] = next();
            return arr;
          }
          return original(arr as ArrayBufferView) as T;
        }) as typeof crypto.getRandomValues;
      });

      await use();
    },
    { auto: true },
  ],
});

export async function installVaultVisualMocks(
  page: Page,
  options: {
    simulationError?: string;
    simulationPending?: boolean;
    signingPending?: boolean;
    submissionPending?: boolean;
    pollStatus?: 'SUCCESS' | 'FAILED';
    networkPassphrase?: string;
  } = {},
) {
  await page.addInitScript(
    (cfg) => {
      const calls: string[] = [];
      (window as unknown as { __vaultCalls: string[] }).__vaultCalls = calls;
      (window as unknown as { __WRAITH_CONFIG__: unknown }).__WRAITH_CONFIG__ = {
        stellarVaultContractId: cfg.contract,
      };

      (window as any).freighterMock = {
        isConnected: async () => ({ isConnected: true }),
        isAllowed: async () => ({ isAllowed: false }),
        requestAccess: async () => ({ address: cfg.sender }),
        getAddress: async () => ({ address: cfg.sender }),
        getNetworkDetails: async () => ({
          network: cfg.networkPassphrase === cfg.testnetPassphrase ? 'TESTNET' : 'PUBLIC',
          networkPassphrase: cfg.networkPassphrase,
        }),
        signTransaction: async (transactionXdr: string) => {
          calls.push('sign');
          if (cfg.signingPending) return new Promise(() => {});
          return { signedTxXdr: transactionXdr };
        },
        WatchWalletChanges: class {
          watch() {}
          stop() {}
        },
      };

      (window as any).sorobanServerMock = {
        getAccount: async (address: string) => {
          calls.push('getAccount');
          return {
            accountId: () => address,
            sequenceNumber: () => '1',
            incrementSequenceNumber: () => {},
          };
        },
        simulateTransaction: async () => {
          calls.push('simulate');
          if (cfg.simulationError) return { error: cfg.simulationError };
          if (cfg.simulationPending) return new Promise(() => {});
          return { minResourceFee: '250', result: {} };
        },
        assembleTransaction: async (transaction: unknown) => {
          calls.push('assemble');
          return { build: () => transaction };
        },
        sendTransaction: async () => {
          calls.push('send');
          return { status: 'PENDING', hash: cfg.txHash };
        },
        pollTransaction: async (hash: string) => {
          calls.push('poll');
          if (cfg.submissionPending) return new Promise(() => {});
          return { status: cfg.pollStatus, hash, returnValue: cfg.depositId };
        },
      };
    },
    {
      sender: MOCK_WALLET,
      contract: 'CCJLJ2QRBJAAKIG6ELNQVXLLWMKKWVN5O2FKWUETHZGMPAD4MHK7WVWL',
      depositId: DEPOSIT_ID,
      txHash: MOCK_TX_HASH,
      testnetPassphrase: 'Test SDF Network ; September 2015',
      networkPassphrase: options.networkPassphrase ?? 'Test SDF Network ; September 2015',
      simulationError: options.simulationError ?? '',
      simulationPending: options.simulationPending ?? false,
      signingPending: options.signingPending ?? false,
      submissionPending: options.submissionPending ?? false,
      pollStatus: options.pollStatus ?? 'SUCCESS',
    },
  );
}

export async function installAuctionVisualMocks(page: Page) {
  const passphrase = 'Test SDF Network ; September 2015';
  const commitEnd = Math.floor(FROZEN_TIME.getTime() / 1000) + 3600;
  const auction = {
    name: 'demo',
    commit_end: BigInt(commitEnd),
    reveal_end: BigInt(commitEnd + 7200),
    highest_bidder: null,
    highest_amount: 0n,
    settled: false,
  };
  const transactionData = new SorobanDataBuilder().build().toXDR('base64');

  await page.route(/^https:\/\/soroban-testnet\.stellar\.org\/?$/, async (route) => {
    const body = route.request().postDataJSON() as {
      id: number;
      params: { transaction: string };
    };
    const transaction = TransactionBuilder.fromXDR(body.params.transaction, passphrase);
    const operation = transaction.operations[0];
    if (operation.type !== 'invokeHostFunction') {
      throw new Error('Auction fixture expected an invoke host function');
    }
    const method = operation.func.invokeContract().functionName().toString();

    let result: xdr.ScVal;
    if (method === 'get_active_auctions') {
      result = nativeToScVal([auction]);
    } else if (method === 'get_auction') {
      result = nativeToScVal(auction);
    } else if (method === 'auction_config') {
      result = nativeToScVal({
        reserve_price: 10_000_000n,
        min_increment: 1_000_000n,
        commit_secs: 3600n,
        reveal_secs: 7200n,
      });
    } else if (method === 'compute_commitment') {
      result = xdr.ScVal.scvBytes(Buffer.from('cd'.repeat(32), 'hex'));
    } else {
      result = xdr.ScVal.scvVoid();
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          id: String(body.id),
          latestLedger: 100,
          transactionData,
          minResourceFee: '100',
          results: [{ auth: [], xdr: result.toXDR('base64') }],
        },
      }),
    });
  });

  await page.route('https://horizon-testnet.stellar.org/accounts/*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: MOCK_WALLET,
        sequence: '1',
        balances: [{ asset_type: 'native', balance: '1000' }],
        subentry_count: 0,
      }),
    });
  });
}

export async function installHorizenWalletMock(
  page: Page,
  mode: 'pending' | 'success' | 'failure',
  account = MOCK_EVM_ACCOUNT,
) {
  await page.addInitScript(
    (cfg) => {
      const listeners = new Map<string, Set<(value: unknown) => void>>();
      let authorized = false;
      const emit = (event: string, value: unknown) => {
        listeners.get(event)?.forEach((listener) => listener(value));
      };
      const provider = {
        isRainbow: true,
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_chainId') return '0x28751c';
          if (method === 'eth_accounts') return authorized ? [cfg.account] : [];
          if (method === 'eth_requestAccounts') {
            authorized = true;
            emit('accountsChanged', [cfg.account]);
            return [cfg.account];
          }
          if (method === 'personal_sign') {
            return '0x457931c0127351a0f68f8182567e0cbb8e075c543e90d6c6b0aa249ba535231e1433329cb65807c37b0034348a20238e08befe41463202e68704c3a47aa184401c';
          }
          if (method === 'eth_sendTransaction') {
            if (cfg.mode === 'pending') return new Promise(() => {});
            if (cfg.mode === 'failure') {
              throw new Error('User rejected transaction signing');
            }
            return cfg.txHash;
          }
          throw new Error(`Unsupported deterministic Ethereum request: ${method}`);
        },
        on: (event: string, listener: (value: unknown) => void) => {
          const eventListeners = listeners.get(event) ?? new Set();
          eventListeners.add(listener);
          listeners.set(event, eventListeners);
        },
        removeListener: (event: string, listener: (value: unknown) => void) => {
          listeners.get(event)?.delete(listener);
        },
      };
      Object.defineProperty(window, 'ethereum', {
        configurable: true,
        value: provider,
      });
    },
    { account, mode, txHash: MOCK_EVM_TX_HASH },
  );

  await page.route('https://horizen-testnet.rpc.caldera.xyz/http', async (route) => {
    const request = route.request().postDataJSON() as { id: number; method: string };
    let result: unknown;
    if (request.method === 'eth_chainId') {
      result = '0x28751c';
    } else if (request.method === 'eth_getBalance') {
      result = '0x56BC75E2D63100000';
    } else if (request.method === 'eth_call') {
      result = '0x';
    } else if (request.method === 'eth_blockNumber') {
      result = '0x2';
    } else if (request.method === 'eth_getTransactionReceipt') {
      result =
        mode === 'success'
          ? {
              transactionHash: MOCK_EVM_TX_HASH,
              transactionIndex: '0x0',
              blockHash: `0x${'11'.repeat(32)}`,
              blockNumber: '0x1',
              from: MOCK_EVM_ACCOUNT,
              to: `0x${'22'.repeat(20)}`,
              cumulativeGasUsed: '0x5208',
              gasUsed: '0x5208',
              contractAddress: null,
              logs: [],
              logsBloom: `0x${'00'.repeat(256)}`,
              status: '0x1',
              effectiveGasPrice: '0x1',
              type: '0x2',
            }
          : null;
    } else {
      await route.fulfill({
        status: 501,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32601, message: `Unsupported visual RPC method: ${request.method}` },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }),
    });
  });

  await page.route('https://api.goldsky.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { announcements: [] } }),
    });
  });
}

export async function installSolanaWalletMock(page: Page, mode: 'pending' | 'success' | 'failure') {
  await page.addInitScript(
    (cfg) => {
      const publicKeyBytes = Uint8Array.from(atob(cfg.publicKeyBytes), (character) =>
        character.charCodeAt(0),
      );
      const publicKey = { toBytes: () => publicKeyBytes };
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      const emit = (event: string, ...args: unknown[]) => {
        listeners.get(event)?.forEach((listener) => listener(...args));
      };
      const provider = {
        isPhantom: true,
        isConnected: false,
        publicKey,
        connect: async () => {
          provider.isConnected = true;
          emit('connect', publicKey);
        },
        disconnect: async () => {
          provider.isConnected = false;
          emit('disconnect');
        },
        on: (event: string, listener: (...args: unknown[]) => void) => {
          const eventListeners = listeners.get(event) ?? new Set();
          eventListeners.add(listener);
          listeners.set(event, eventListeners);
        },
        off: (event: string, listener: (...args: unknown[]) => void) => {
          listeners.get(event)?.delete(listener);
        },
        signAndSendTransaction: async () => {
          if (cfg.mode === 'pending') return new Promise(() => {});
          if (cfg.mode === 'failure') {
            throw new Error('User rejected transaction signing');
          }
          return { signature: cfg.signature };
        },
        signMessage: async () => ({
          signature: new Uint8Array(64).fill(0xab),
          publicKey,
        }),
      };
      Object.defineProperty(window, 'phantom', {
        configurable: true,
        value: { solana: provider },
      });
      Object.defineProperty(window, 'isPhantomInstalled', {
        configurable: true,
        value: true,
      });
    },
    {
      publicKeyBytes: MOCK_SOLANA_PUBLIC_KEY,
      signature: MOCK_SOLANA_SIGNATURE,
      mode,
    },
  );

  await page.routeWebSocket(/^wss:\/\/api\.devnet\.solana\.com\/?$/, (socket) => {
    socket.onMessage((message) => {
      if (typeof message !== 'string') return;
      const request = JSON.parse(message) as { id: number; method: string };
      if (request.method === 'signatureSubscribe') {
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: 1 }));
        if (mode === 'success') {
          socket.send(
            JSON.stringify({
              jsonrpc: '2.0',
              method: 'signatureNotification',
              params: {
                subscription: 1,
                result: { context: { slot: 2 }, value: { err: null } },
              },
            }),
          );
        }
      } else if (request.method === 'signatureUnsubscribe') {
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: true }));
      }
    });
  });

  await page.route('https://api.devnet.solana.com', async (route) => {
    const request = route.request().postDataJSON() as { id: number; method: string };
    let result: unknown;
    if (request.method === 'getSignaturesForAddress') {
      result = [];
    } else if (request.method === 'getLatestBlockhash') {
      result = {
        context: { slot: 1 },
        value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1000 },
      };
    } else if (request.method === 'getFeeForMessage') {
      result = { context: { slot: 1 }, value: 5000 };
    } else if (request.method === 'getSignatureStatuses') {
      result = {
        context: { slot: 2 },
        value:
          mode === 'success'
            ? [{ slot: 2, confirmations: 1, err: null, confirmationStatus: 'confirmed' }]
            : [null],
      };
    } else if (request.method === 'getBlockHeight') {
      result = 2;
    } else {
      await route.fulfill({
        status: 501,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32601, message: `Unsupported visual RPC method: ${request.method}` },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }),
    });
  });
}

export async function installCkbWalletMock(page: Page) {
  await page.addInitScript(() => {
    const signer = {
      type: 'CKB',
      client: { addressPrefix: 'ckt' },
      connect: async () => {},
      disconnect: async () => {},
      isConnected: async () => true,
      getRecommendedAddress: async () => 'ckt1qyq9s6wz3w5y2x0v6k0u8p9n4m3r2t1s0q8w7e6d5c4b3a2',
      signMessageRaw: async () => `0x${'01'.repeat(65)}`,
      onReplaced: () => () => {},
    };
    const wallet = {
      name: 'Wraith Visual Wallet',
      icon: '',
      signers: [{ name: 'CKB Testnet', signer }],
    };
    const registry = window.customElements;
    const originalDefine = registry.define.bind(registry);
    registry.define = ((
      name: string,
      ctor: CustomElementConstructor,
      options?: ElementDefinitionOptions,
    ) => {
      if (name === 'ccc-connector') {
        const prototype = ctor.prototype as unknown as {
          connectedCallback: () => void;
          signersControllerInner: {
            wallets: unknown[];
            refresh: () => Promise<void>;
          };
        };
        const originalConnectedCallback = prototype.connectedCallback;
        prototype.connectedCallback = function () {
          this.signersControllerInner.wallets = [wallet];
          this.signersControllerInner.refresh = async () => {};
          originalConnectedCallback.call(this);
        };
      }
      originalDefine(name, ctor, options);
    }) as typeof registry.define;
  });
  await page.route('https://testnet.ckbapp.dev', async (route) => {
    const request = route.request().postDataJSON() as { id: number };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: { objects: [], last_cursor: '0x' },
      }),
    });
  });
}

export { expect };
