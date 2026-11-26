/**
 * Chain-agnostic wallet transition conformance harness.
 *
 * Providers are mocked at the boundary the app uses for each chain (EIP-1193,
 * Freighter, Phantom, CCC) so the suite can suspend a request, change the
 * wallet context, and then resolve the original request without a live
 * browser extension.
 */

import {
  WalletScopedCache,
  WalletSession,
  type WalletChain,
  type WalletIdentity,
  type WalletOperationPolicy,
} from '../session';

export type ConformanceOperation = 'simulate' | 'sign' | 'scan' | 'submit';

export type ConformanceTransition =
  | 'disconnect'
  | 'account-change'
  | 'network-change'
  | 'provider-replacement';

export interface ConformanceChainSpec {
  chain: WalletChain;
  provider: string;
  account: string;
  nextAccount: string;
  network: string;
  nextNetwork: string;
  /** Provider method names, used to keep the mock chain-shaped. */
  requests: Record<ConformanceOperation, string>;
}

export interface OperationGate {
  /** Resolves once the provider has received the request. */
  started: Promise<void>;
  /** Resolves the suspended provider request. */
  release: () => void;
  /** Rejects the suspended provider request with the supplied error. */
  fail: (error: Error) => void;
}

interface PendingGate {
  markStarted: () => void;
  started: Promise<void>;
  wait: Promise<void>;
  release: () => void;
  fail: (error: Error) => void;
}

export class MockChainProvider {
  account: string;
  network: string;
  provider: string;
  connected = true;

  readonly calls: ConformanceOperation[] = [];
  readonly requestNames: string[] = [];

  private readonly gates = new Map<ConformanceOperation, PendingGate>();
  private readonly rejections = new Map<ConformanceOperation, string>();

  constructor(private readonly spec: ConformanceChainSpec) {
    this.account = spec.account;
    this.network = spec.network;
    this.provider = spec.provider;
  }

  identity(): WalletIdentity | null {
    if (!this.connected) return null;
    return {
      chain: this.spec.chain,
      provider: this.provider,
      account: this.account,
      network: this.network,
    };
  }

  delayNext(operation: ConformanceOperation): OperationGate {
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });

    let release!: () => void;
    let fail!: (error: Error) => void;
    const wait = new Promise<void>((resolve, reject) => {
      release = resolve;
      fail = reject;
    });

    this.gates.set(operation, { markStarted, started, wait, release, fail });
    return { started, release, fail };
  }

  rejectNext(operation: ConformanceOperation, message = 'User rejected the request'): void {
    this.rejections.set(operation, message);
  }

  async perform(
    operation: ConformanceOperation,
    payload: string,
    identity: WalletIdentity,
  ): Promise<string> {
    this.calls.push(operation);
    this.requestNames.push(this.spec.requests[operation]);

    const gate = this.gates.get(operation);
    if (gate) {
      this.gates.delete(operation);
      gate.markStarted();
      try {
        await gate.wait;
      } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
      }
    }

    const rejection = this.rejections.get(operation);
    if (rejection) {
      this.rejections.delete(operation);
      throw new Error(rejection);
    }

    return `${this.spec.requests[operation]}:${identity.account}:${payload}`;
  }
}

export class WalletTransitionHarness {
  readonly session: WalletSession;
  readonly cache: WalletScopedCache<string>;
  readonly provider: MockChainProvider;

  constructor(readonly spec: ConformanceChainSpec) {
    this.provider = new MockChainProvider(spec);
    this.session = new WalletSession(this.provider.identity());
    this.cache = new WalletScopedCache(this.session);
  }

  transition(kind: ConformanceTransition): void {
    switch (kind) {
      case 'disconnect':
        this.provider.connected = false;
        this.session.update(null);
        break;
      case 'account-change':
        this.provider.account = this.spec.nextAccount;
        this.session.update(this.provider.identity());
        break;
      case 'network-change':
        this.provider.network = this.spec.nextNetwork;
        this.session.update(this.provider.identity());
        break;
      case 'provider-replacement':
        this.provider.provider = `${this.spec.provider}:replacement`;
        this.session.update(this.provider.identity());
        break;
    }
  }

  /** A single read or signing call guarded by the wallet session. */
  run(operation: ConformanceOperation, policy: WalletOperationPolicy = 'cancel'): Promise<string> {
    return this.session.run(
      `conformance:${operation}`,
      async (walletOperation) => {
        walletOperation.assertActive();
        const result = await this.provider.perform(operation, 'payload', walletOperation.identity);
        walletOperation.assertActive();
        return result;
      },
      { policy },
    );
  }

  /** The multi-step send path: sign, verify the context, then submit. */
  signAndSubmit(policy: WalletOperationPolicy = 'cancel'): Promise<string> {
    return this.session.run(
      'conformance:send',
      async (walletOperation) => {
        const signed = await this.provider.perform(
          'sign',
          'unsigned-transaction',
          walletOperation.identity,
        );

        // The context is rechecked between signing and submission so stale
        // material can never be broadcast under a replacement wallet.
        walletOperation.assertActive();
        return this.provider.perform('submit', signed, walletOperation.identity);
      },
      { policy },
    );
  }
}
