import { useAuthStore, useChatStore } from '@chappie/shared';
import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { IconRail } from '@/components/layout/icon-rail';
import { Sidebar } from '@/components/layout/sidebar';
import { toast } from '@/components/ui/toast';
import { connectRealtime, disconnectRealtime } from '@/lib/realtime';

export function AppShell() {
  const status = useAuthStore((s) => s.status);
  const token = useAuthStore((s) => s.token);
  const loadConversations = useChatStore((s) => s.loadConversations);

  useEffect(() => {
    if (status !== 'ready' || !token) return;
    connectRealtime('web');
    void loadConversations().catch((e) =>
      toast.error('加载会话失败', e instanceof Error ? e.message : String(e)),
    );
    return () => disconnectRealtime();
  }, [status, token, loadConversations]);

  if (status !== 'ready') return <Navigate to="/login" replace />;

  return (
    <div className="flex h-full overflow-hidden bg-canvas">
      <IconRail />
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col bg-view">
        <Outlet />
      </main>
    </div>
  );
}
