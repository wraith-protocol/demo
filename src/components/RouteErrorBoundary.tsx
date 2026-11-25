import {
  Component,
  createContext,
  lazy,
  useContext,
  type ComponentType,
  type ErrorInfo,
  type LazyExoticComponent,
  type ReactNode,
} from 'react';

interface RouteErrorBoundaryProps {
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  error: Error | null;
  retryAttempt: number;
}

export type PageLoader = () => Promise<{ default: ComponentType }>;

const retryAttemptContext = createContext(0);
const lazyPageCache = new WeakMap<PageLoader, Map<number, LazyExoticComponent<ComponentType>>>();

function getLazyPage(loader: PageLoader, attempt: number) {
  let attempts = lazyPageCache.get(loader);
  if (!attempts) {
    attempts = new Map();
    lazyPageCache.set(loader, attempts);
  }

  let page = attempts.get(attempt);
  if (!page) {
    page = lazy(loader);
    attempts.set(attempt, page);
  }
  return page;
}

/**
 * Keep each lazy component stable across Suspense retries. React discards
 * useMemo caches when a component suspends during its initial render.
 */
export function LazyPage({ loader }: { loader: PageLoader }) {
  const attempt = useContext(retryAttemptContext);
  const Page = getLazyPage(loader, attempt);
  return <Page />;
}

/**
 * Catches failures from lazy-loaded route chunks (LazyPage/React.lazy in
 * App.tsx). A dynamic import() rejects when a chunk 404s, most commonly
 * because the user has an old tab open across a new deploy and the hashed
 * chunk URL no longer exists, or a flaky connection dropped the request.
 * "Retry" clears the error, which swaps this boundary's rendered output
 * back from the fallback to `children`: since that's a different subtree
 * at this position, React remounts it from scratch, giving any LazyPage
 * inside a fresh lazy component and a fresh import() attempt instead of
 * replaying the same rejected one forever. That usually succeeds on a
 * transient network blip. If the chunk itself is gone (stale deploy), the
 * full reload picks up the current index.html and asset manifest instead
 * of retrying the same dead URL forever.
 */
export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { error: null, retryAttempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<RouteErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Route chunk failed to load', error, info.componentStack);
  }

  private retry = () => {
    this.setState((state) => ({ error: null, retryAttempt: state.retryAttempt + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="flex min-h-[40vh] flex-col items-center justify-center gap-4 py-16 text-center"
        >
          <p className="font-heading text-sm uppercase tracking-widest text-on-surface">
            This page failed to load
          </p>
          <p className="max-w-sm font-body text-xs leading-relaxed text-on-surface-variant">
            That can happen after a new version ships while this tab was open, or on a flaky
            connection.
          </p>
          <div className="mt-2 flex gap-3">
            <button
              type="button"
              onClick={this.retry}
              className="h-11 border border-primary px-6 font-heading text-[11px] font-semibold uppercase tracking-widest text-primary"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="h-11 bg-primary px-6 font-heading text-[11px] font-semibold uppercase tracking-widest text-surface"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return (
      <retryAttemptContext.Provider value={this.state.retryAttempt ?? 0}>
        {this.props.children}
      </retryAttemptContext.Provider>
    );
  }
}
