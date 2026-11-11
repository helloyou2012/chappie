import {
  RealtimeClient,
  type RealtimeStatus,
  setPullHandler,
  useAuthStore,
  useChatStore,
  wsUrlFromServerUrl,
} from '@chappie/shared';

let client: RealtimeClient | null = null;
const listeners = new Set<(s: RealtimeStatus) => void>();

export function connectRealtime(platform: 'web' | 'desktop' = 'web'): void {
  const { token, serverUrl, status } = useAuthStore.getState();
  if (!token || status !== 'ready') return;
  disconnectRealtime();

  client = new RealtimeClient({
    url: wsUrlFromServerUrl(serverUrl),
    token,
    platform,
    handlers: {
      onFrame: (frame) => useChatStore.getState().applyServerFrame(frame),
      onStatus: (s) => {
        for (const fn of listeners) fn(s);
      },
      onAuthError: (message) => {
        console.warn('realtime auth error:', message);
        void useAuthStore.getState().logout();
      },
    },
  });
  setPullHandler((convId, fromSeq) => client?.pullMessages(convId, fromSeq));
  client.connect();
}

export function disconnectRealtime(): void {
  setPullHandler(null);
  client?.close();
  client = null;
}

export function getRealtimeClient(): RealtimeClient | null {
  return client;
}

export function subscribeRealtimeStatus(fn: (s: RealtimeStatus) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
