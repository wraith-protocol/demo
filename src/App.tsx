import { Routes, Route, Navigate } from 'react-router-dom';
import { Header } from '@/components/Header';
import Send from '@/pages/Send';
import Receive from '@/pages/Receive';

export function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-6 pb-24 pt-10">
        <Routes>
          <Route path="/send" element={<Send />} />
          <Route path="/receive" element={<Receive />} />
          <Route path="*" element={<Navigate to="/send" replace />} />
        </Routes>
      </main>
    </div>
  );
}
