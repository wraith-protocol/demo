/** @vitest-environment jsdom */
import { Suspense, type ComponentType } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LazyPage, RouteErrorBoundary, type PageLoader } from './RouteErrorBoundary';

describe('RouteErrorBoundary retry', () => {
  it('re-attempts a fresh import on retry instead of replaying the cached rejection', async () => {
    // Gated on a flag the test flips, not a call-count cutover: an uncommitted
    // Suspense boundary can internally replay its first mount attempt several
    // times in React's dev build, which would make a fixed "resolve on call N"
    // mock flaky. The loader keeps rejecting through all of that replay noise,
    // and only starts succeeding once the test simulates the fix being
    // available and clicks Retry.
    let shouldSucceed = false;
    const loader: PageLoader = () => {
      if (!shouldSucceed) {
        return Promise.reject(new Error('chunk failed'));
      }
      return Promise.resolve({ default: (() => <div>Loaded page</div>) as ComponentType });
    };

    render(
      <RouteErrorBoundary>
        <Suspense fallback={<div>Loading...</div>}>
          <LazyPage loader={loader} />
        </Suspense>
      </RouteErrorBoundary>,
    );

    await waitFor(() => screen.getByRole('alert'));

    shouldSucceed = true;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => screen.getByText('Loaded page'));
  });
});
