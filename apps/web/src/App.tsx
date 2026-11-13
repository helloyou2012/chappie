import { useAuthStore } from '@chappie/shared';
import { RiLoader4Line } from '@remixicon/react';
import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/app-shell';
import { Toaster } from '@/components/ui/toast';
import { initTheme } from '@/lib/theme';
import { ApprovalsPage } from '@/pages/approvals-page';
import { AvatarConsolePage } from '@/pages/avatar-console-page';
import { ChatPage } from '@/pages/chat-page';
import { LoginPage } from '@/pages/login-page';
import { ReportsPage } from '@/pages/reports-page';
import { SchedulePage } from '@/pages/schedule-page';

export default function App() {
  const status = useAuthStore((s) => s.status);
  const restore = useAuthStore((s) => s.restore);

  useEffect(() => {
    initTheme();
    void restore();
  }, [restore]);

  if (status === 'init') {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <RiLoader4Line className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={status === 'ready' ? <Navigate to="/chat" replace /> : <LoginPage />}
        />
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="/chat/:convId?" element={<ChatPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/avatar" element={<AvatarConsolePage />} />
          <Route path="/reports" element={<ReportsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}
