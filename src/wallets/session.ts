/**
 * Wallet session guard.
 *
 * Wallet providers can change account, network, or the provider instance
 * itself while an async operation is in flight. Every critical wallet
 * operation (simulate, sign, scan, submit) runs inside a session operation so
 * a transition can invalidate the work before stale material reaches signing
 * or submission.
 *
 * The guard is chain-agnostic: each chain supplies a WalletIdentity and any
 * provider-specific calls live outside this module.
 */

export type WalletChain = 'horizen' | 'stellar' | 'solana' | 'ckb';

export interface WalletIdentity {
  chain: WalletChain;
  /** Stable adapter/provider identifier, e.g. "freighter" or "phantom". */
  provider: string;
  account: string;
  network: string;
}

export type WalletTransitionReason =
  | 'connect'
  | 'disconnect'
  | 'account-change'
  | 'network-change'
  | 'provider-replacement'
  | 'chain-change';

export type WalletOperationPolicy = 'cancel' | 'confirm';

export type WalletOperationState = 'active' | 'aborted' | 'confirmation-required' | 'completed';

export interface WalletTransition {
  reason: WalletTransitionReason;
  previous: WalletIdentity | null;
  current: WalletIdentity | null;
  revision: number;
}

export interface BeginOperationOptions {
  /**
   * `cancel` (default) fails the operation immediately. `confirm` also stops
   * the in-flight work, but reports that a fresh confirmation is required
   * rather than a hard cancellation.
   */
  policy?: WalletOperationPolicy;
}

export class WalletNotConnectedError extends Error {
  readonly code = 'WALLET_NOT_CONNECTED';

  constructor(readonly operation: string) {
    super(`No wallet is connected for ${operation}`);
    this.name = 'WalletNotConnectedError';
  }
}

export class WalletContextChangedError extends Error {
  readonly code = 'WALLET_CONTEXT_CHANGED';

  constructor(
    readonly operation: string,
    readonly reason: WalletTransitionReason,
  ) {
    super(`Wallet context changed (${reason}) during ${operation}`);
    this.name = 'WalletContextChangedError';
  }
}

export class WalletConfirmationRequiredError extends Error {
  readonly code = 'WALLET_CONFIRMATION_REQUIRED';

  constructor(
    readonly operation: string,
    readonly reason: WalletTransitionReason,
  ) {
    super(`Wallet context changed (${reason}); confirm ${operation} again`);
    this.name = 'WalletConfirmationRequiredError';
  }
}

export function sameWalletIdentity(a: WalletIdentity | null, b: WalletIdentity | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.chain === b.chain &&
    a.provider === b.provider &&
    a.account === b.account &&
    a.network === b.network
  );
}

export function walletIdentityKey(identity: WalletIdentity | null): string | null {
  if (!identity) return null;
  return [identity.chain, identity.provider, identity.account, identity.network].join('|');
}

function classifyTransition(
  previous: WalletIdentity | null,
  next: WalletIdentity | null,
  providerReplaced: boolean,
): WalletTransitionReason {
  if (!next) return 'disconnect';
  if (!previous) return 'connect';
  if (previous.chain !== next.chain) return 'chain-change';
  if (providerReplaced || previous.provider !== next.provider) return 'provider-replacement';
  if (previous.account !== next.account) return 'account-change';
  if (previous.network !== next.network) return 'network-change';
  return 'provider-replacement';
}

let nextProviderInstanceId = 0;
const providerInstanceIds = new WeakMap<object, number>();

/**
 * Returns a stable id for a provider instance. Replacing the provider object
 * (without changing its name) yields a new id, so identity comparison detects
 * provider replacement.
 */
export function providerInstanceId(provider: object | null | undefined): string {
  if (!provider) return 'none';
  let id = providerInstanceIds.get(provider);
  if (id === undefined) {
    nextProviderInstanceId += 1;
    id = nextProviderInstanceId;
    providerInstanceIds.set(provider, id);
  }
  return String(id);
}

export class WalletOperation {
  private operationState: WalletOperationState = 'active';
  private transitionReason: WalletTransitionReason | null = null;
  private readonly controller = new AbortController();

  constructor(
    private readonly session: WalletSession,
    readonly kind: string,
    readonly identity: WalletIdentity,
    readonly policy: WalletOperationPolicy,
  ) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get state(): WalletOperationState {
    return this.operationState;
  }

  get reason(): WalletTransitionReason | null {
    return this.transitionReason;
  }

  get active(): boolean {
    return this.operationState === 'active' && !this.controller.signal.aborted;
  }

  assertActive(): void {
    if (this.operationState === 'confirmation-required') {
      throw new WalletConfirmationRequiredError(
        this.kind,
        this.transitionReason ?? 'provider-replacement',
      );
    }

    if (
      this.operationState === 'aborted' ||
      this.operationState === 'completed' ||
      this.controller.signal.aborted ||
      !sameWalletIdentity(this.session.identity, this.identity)
    ) {
      throw new WalletContextChangedError(
        this.kind,
        this.transitionReason ?? 'provider-replacement',
      );
    }
  }

  /** Stops the in-flight work. Further asserts fail with the transition reason. */
  abort(reason: WalletTransitionReason): void {
    if (this.operationState !== 'active') return;
    this.operationState = 'aborted';
    this.transitionReason = reason;
    this.controller.abort(reason);
  }

  /** Stops the work and asks the caller to confirm it again. */
  requireConfirmation(reason: WalletTransitionReason): void {
    if (this.operationState !== 'active') return;
    this.operationState = 'confirmation-required';
    this.transitionReason = reason;
    this.controller.abort(reason);
  }

  complete(): void {
    if (this.operationState === 'active') {
      this.operationState = 'completed';
    }
  }
}

export class WalletSession {
  private currentIdentity: WalletIdentity | null;
  private currentRevision = 0;
  private readonly operations = new Set<WalletOperation>();
  private readonly listeners = new Set<(transition: WalletTransition) => void>();

  constructor(identity: WalletIdentity | null = null) {
    this.currentIdentity = identity;
  }

  get identity(): WalletIdentity | null {
    return this.currentIdentity;
  }

  get revision(): number {
    return this.currentRevision;
  }

  get pendingOperations(): number {
    let pending = 0;
    for (const operation of this.operations) {
      if (operation.active) pending += 1;
    }
    return pending;
  }

  subscribe(listener: (transition: WalletTransition) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Applies a new wallet identity. Returns the transition when anything
   * changed, or null when the identity is unchanged.
   */
  update(
    next: WalletIdentity | null,
    options: { providerReplaced?: boolean } = {},
  ): WalletTransition | null {
    const providerReplaced = options.providerReplaced ?? false;

    if (sameWalletIdentity(this.currentIdentity, next) && !providerReplaced) {
      return null;
    }

    const previous = this.currentIdentity;
    const reason = classifyTransition(previous, next, providerReplaced);

    this.currentIdentity = next;
    this.currentRevision += 1;

    const transition: WalletTransition = {
      reason,
      previous,
      current: next,
      revision: this.currentRevision,
    };

    for (const operation of [...this.operations]) {
      if (operation.policy === 'confirm') {
        operation.requireConfirmation(reason);
      } else {
        operation.abort(reason);
      }
    }

    for (const listener of [...this.listeners]) {
      listener(transition);
    }

    return transition;
  }

  /** Invalidates every in-flight operation even if the identity is unchanged. */
  invalidate(reason: WalletTransitionReason = 'provider-replacement'): WalletTransition {
    this.currentRevision += 1;

    const transition: WalletTransition = {
      reason,
      previous: this.currentIdentity,
      current: this.currentIdentity,
      revision: this.currentRevision,
    };

    for (const operation of [...this.operations]) {
      if (operation.policy === 'confirm') {
        operation.requireConfirmation(reason);
      } else {
        operation.abort(reason);
      }
    }

    for (const listener of [...this.listeners]) {
      listener(transition);
    }

    return transition;
  }

  begin(kind: string, options: BeginOperationOptions = {}): WalletOperation {
    if (!this.currentIdentity) {
      throw new WalletNotConnectedError(kind);
    }

    const operation = new WalletOperation(
      this,
      kind,
      this.currentIdentity,
      options.policy ?? 'cancel',
    );
    this.operations.add(operation);
    return operation;
  }

  finish(operation: WalletOperation): void {
    operation.complete();
    this.operations.delete(operation);
  }

  /**
   * Runs an operation and verifies the wallet context is still current when it
   * settles. Callers that perform multiple steps (build → sign → submit) must
   * call `operation.assertActive()` between steps.
   */
  async run<T>(
    kind: string,
    work: (operation: WalletOperation) => Promise<T>,
    options: BeginOperationOptions = {},
  ): Promise<T> {
    const operation = this.begin(kind, options);
    try {
      const result = await work(operation);
      operation.assertActive();
      return result;
    } finally {
      this.finish(operation);
    }
  }

  dispose(): void {
    for (const operation of [...this.operations]) {
      operation.abort('disconnect');
    }
    this.operations.clear();
    this.listeners.clear();
  }
}

/**
 * Cache whose contents belong to exactly one wallet context. Reading after an
 * account, network, provider, or chain transition drops the previous scope
 * before returning, so balances or activity from another wallet can never be
 * read into the current one.
 */
export class WalletScopedCache<T> {
  private scopeKey: string | null = null;
  private readonly values = new Map<string, T>();

  constructor(private readonly session: WalletSession) {}

  get scope(): string | null {
    this.syncScope();
    return this.scopeKey;
  }

  get size(): number {
    this.syncScope();
    return this.values.size;
  }

  get(key: string): T | undefined {
    this.syncScope();
    return this.values.get(key);
  }

  has(key: string): boolean {
    this.syncScope();
    return this.values.has(key);
  }

  set(key: string, value: T): boolean {
    this.syncScope();
    if (!this.scopeKey) return false;
    this.values.set(key, value);
    return true;
  }

  delete(key: string): boolean {
    this.syncScope();
    return this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }

  private syncScope(): void {
    const identity = this.session.identity;
    const nextScope = identity ? `${this.session.revision}:${walletIdentityKey(identity)}` : null;

    if (nextScope !== this.scopeKey) {
      this.scopeKey = nextScope;
      this.values.clear();
    }
  }
}
