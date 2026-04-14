import { Routes, Route, Navigate } from 'react-router-dom';
import { Header } from '@/components/Header';
import { AutoSign } from '@/components/AutoSign';
import Send from '@/pages/Send';
import Receive from '@/pages/Receive';

export function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <AutoSign />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-10">
        <Routes>
          <Route path="/send" element={<Send />} />
          <Route path="/receive" element={<Receive />} />
          <Route path="*" element={<Navigate to="/send" replace />} />
        </Routes>
      </main>
    </div>
  );
}
