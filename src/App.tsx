import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Header } from '@/components/Header';
import { AutoSign } from '@/components/AutoSign';
import { useStellarTour } from '@/hooks/useStellarTour';
import Send from '@/pages/Send';
import Receive from '@/pages/Receive';

function TourAutoStart() {
  const location = useLocation();
  const { startTour } = useStellarTour();

  useEffect(() => {
    if (location.pathname === '/send') {
      // Small delay to let the DOM settle before driver.js queries elements
      const id = setTimeout(() => startTour(), 300);
      return () => clearTimeout(id);
    }
  }, [location.pathname, startTour]);

  return null;
}

function Footer() {
  const { startTour } = useStellarTour();

  return (
    <footer className="border-t border-outline-variant/30 py-4 text-center">
      <button
        onClick={() => startTour(true)}
        data-testid="restart-tour"
        className="font-heading text-[10px] uppercase tracking-widest text-outline transition-colors hover:text-on-surface-variant"
      >
        Take the tour
      </button>
    </footer>
  );
}

export function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <AutoSign />
      <TourAutoStart />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-10">
        <Routes>
          <Route path="/send" element={<Send />} />
          <Route path="/receive" element={<Receive />} />
          <Route path="*" element={<Navigate to="/send" replace />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
