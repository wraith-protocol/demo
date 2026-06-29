import { Routes, Route, Navigate } from 'react-router-dom';
import { Header } from '@/components/Header';
import { AutoSign } from '@/components/AutoSign';
import Send from '@/pages/Send';
import Receive from '@/pages/Receive';

export function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-primary focus:text-surface focus:px-4 focus:py-2">
        Skip to content
      </a>
      <Header />
      <AutoSign />
      <main id="main-content" className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-10">
        <Routes>
          <Route path="/send" element={<Send />} />
          <Route path="/receive" element={<Receive />} />
          <Route path="*" element={<Navigate to="/send" replace />} />
        </Routes>
      </main>
    </div>
  );
}
