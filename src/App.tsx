import { Routes, Route, Navigate } from 'react-router-dom';

export function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="mx-auto w-full max-w-[720px] flex-1 px-6 pb-24 pt-8">
        <Routes>
          <Route path="/send" element={<div>Send</div>} />
          <Route path="/receive" element={<div>Receive</div>} />
          <Route path="*" element={<Navigate to="/send" replace />} />
        </Routes>
      </main>
    </div>
  );
}
