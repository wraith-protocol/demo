import { Routes, Route, Navigate } from 'react-router-dom';
import { Header } from '@/components/Header';
import { AutoSign } from '@/components/AutoSign';
import { HelpButton } from '@/components/HelpButton';
import Send from '@/pages/Send';
import Receive from '@/pages/Receive';
import Vault from '@/pages/Vault';

export function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <AutoSign />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-10">
        <Routes>
          <Route path="/send" element={<Send />} />
          <Route path="/receive" element={<Receive />} />
          <Route path="/vault" element={<Vault />} />
          <Route path="/pay" element={<Send />} />
          <Route path="*" element={<Navigate to="/send" replace />} />
        </Routes>
      </main>
      <HelpButton />
    </div>
  );
}
