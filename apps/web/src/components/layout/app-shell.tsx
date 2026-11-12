import { useAuthStore, useChatStore } from '@chappie/shared';
import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { IconRail } from '@/components/layout/icon-rail';
import { Sidebar } from '@/components/layout/sidebar';
import { toast } from '@/components/ui/toast';
import { connectRealtime, disconnectRealtime } from '@/lib/realtime';

export function AppShell() {
  const status = useAuthStore((s) => s.status);
  const token = useAuthStore((s) => s.token);
  const loadConversations = useChatStore((s) => s.loadConversations);
  const location = useLocation();
  // 会话列表只在「聊天」路由出现；审批/分身/日报直接占满内容卡片
  const showConversations = location.pathname.startsWith('/chat');

  useEffect(() => {
    if (status !== 'ready' || !token) return;
    // Tauri 复用了同一份 Web 前端，需要按注入的运行时标记区分桌面端
    const platform =
      typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? 'desktop' : 'web';
    connectRealtime(platform);
    void loadConversations().catch((e) =>
      toast.error('加载会话失败', e instanceof Error ? e.message : String(e)),
    );
    return () => disconnectRealtime();
  }, [status, token, loadConversations]);

  if (status !== 'ready') return <Navigate to="/login" replace />;

  return (
    <div className="flex h-full overflow-hidden bg-canvas py-1 pr-1">
      <IconRail />
      <section className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl border border-line bg-view shadow-card">
        {showConversations ? <Sidebar /> : null}
        <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </section>
    </div>
  );
}
