import { Routes, Route, Navigate } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useState } from 'react';
import { Header } from '@/components/Header';
import { AutoSign } from '@/components/AutoSign';
import { OfflineShell } from '@/components/OfflineShell';
import { UpdateToast } from '@/components/UpdateToast';
import { InstallPrompt } from '@/components/InstallPrompt';
import Send from '@/pages/Send';
import Receive from '@/pages/Receive';

export function App() {
  const [showUpdate, setShowUpdate] = useState(false);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onNeedRefresh() {
      setShowUpdate(true);
    },
  });

  const handleUpdate = () => {
    setShowUpdate(false);
    updateServiceWorker(true);
  };

  return (
    <OfflineShell>
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

      {needRefresh && showUpdate && (
        <UpdateToast onUpdate={handleUpdate} onDismiss={() => setShowUpdate(false)} />
      )}

      <InstallPrompt />
    </OfflineShell>
  );
}
