import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Header } from '@/components/Header';
import { AutoSign } from '@/components/AutoSign';
import { TelemetryBanner } from '@/components/TelemetryBanner';
import { HelpButton } from '@/components/HelpButton';
import {
  StellarSendSkeleton,
  StellarReceiveSkeleton,
  StellarWithdrawSkeleton,
  StellarActivitySkeleton,
  StellarSettingsSkeleton,
} from '@/components/Skeletons';

// Lazy-load every page so each Route gets its own Suspense boundary and the
// correct skeleton is shown while the chunk is fetched/parsed.
const Send = lazy(() => import('@/pages/Send'));
const Receive = lazy(() => import('@/pages/Receive'));
const Privacy = lazy(() => import('@/pages/Privacy'));
const Vault = lazy(() => import('@/pages/Vault'));
const Schedule = lazy(() => import('@/pages/Schedule'));
const History = lazy(() => import('@/pages/History'));

export function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <TelemetryBanner />
      <AutoSign />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-10">
        <Routes>
          <Route
            path="/send"
            element={
              <Suspense fallback={<StellarSendSkeleton />}>
                <Send />
              </Suspense>
            }
          />
          <Route
            path="/receive"
            element={
              <Suspense fallback={<StellarReceiveSkeleton />}>
                <Receive />
              </Suspense>
            }
          />
          <Route
            path="/vault"
            element={
              <Suspense fallback={<StellarWithdrawSkeleton />}>
                <Vault />
              </Suspense>
            }
          />
          <Route
            path="/history"
            element={
              <Suspense fallback={<StellarActivitySkeleton />}>
                <History />
              </Suspense>
            }
          />
          <Route
            path="/schedule"
            element={
              <Suspense fallback={<StellarSettingsSkeleton />}>
                <Schedule />
              </Suspense>
            }
          />
          <Route
            path="/privacy"
            element={
              <Suspense fallback={<StellarSendSkeleton />}>
                <Privacy />
              </Suspense>
            }
          />
          {/* /pay is a payment-link entry point — reuses the Send chunk */}
          <Route
            path="/pay"
            element={
              <Suspense fallback={<StellarSendSkeleton />}>
                <Send />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/send" replace />} />
        </Routes>
      </main>
      <HelpButton />
    </div>
  );
}
