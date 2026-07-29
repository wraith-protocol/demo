import { Routes, Route, Navigate } from 'react-router-dom';
import { Header } from '@/components/Header';
import { AutoSign } from '@/components/AutoSign';
import { TelemetryBanner } from '@/components/TelemetryBanner';
import Send from '@/pages/Send';
import Receive from '@/pages/Receive';
import Privacy from '@/pages/Privacy';
import { HelpButton } from '@/components/HelpButton';
import Vault from '@/pages/Vault';
import Schedule from '@/pages/Schedule';
import StellarSplit from '@/pages/StellarSplit';
import Names from '@/pages/Names';
import Activity from '@/pages/Activity';

export function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <TelemetryBanner />
      <AutoSign />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-4 pb-16 pt-8 sm:px-6 sm:pb-24 sm:pt-10">
        <Routes>
          <Route path="/send" element={<Send />} />
          <Route path="/receive" element={<Receive />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/vault" element={<Vault />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/stellar/split" element={<StellarSplit />} />
          <Route path="/pay" element={<Send />} />
          <Route path="/names" element={<Names />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="*" element={<Navigate to="/send" replace />} />
        </Routes>
      </main>
      <HelpButton />
    </div>
  );
}
