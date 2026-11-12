import {
  APP_VERSION,
  CommandOutbox,
  detectWebCapabilities,
  getOrCreateDeviceId,
  RealtimeClient,
  type RealtimeStatus,
  STORAGE_KEYS,
  setPullHandler,
  storageGet,
  storageSet,
  useAuthStore,
  useChatStore,
  wsUrlFromServerUrl,
} from '@chappie/shared';

let client: RealtimeClient | null = null;
let generation = 0;
const listeners = new Set<(s: RealtimeStatus) => void>();

export function connectRealtime(platform: 'web' | 'desktop' = 'web'): void {
  const { token, serverUrl, status, user } = useAuthStore.getState();
  if (!token || status !== 'ready') return;
  disconnectRealtime();
  const myGeneration = ++generation;

  void (async () => {
    const deviceId = await getOrCreateDeviceId();
    if (myGeneration !== generation) return;

    client = new RealtimeClient({
      url: wsUrlFromServerUrl(serverUrl),
      token,
      platform,
      device: {
        deviceId,
        appVersion: APP_VERSION,
        capabilities: detectWebCapabilities(),
      },
      outbox: new CommandOutbox(user?.id ?? 'anonymous'),
      handlers: {
        onFrame: (frame) => useChatStore.getState().applyServerFrame(frame),
        onStatus: (s) => {
          for (const fn of listeners) fn(s);
        },
        onAuthError: (message) => {
          console.warn('realtime auth error:', message);
          void useAuthStore.getState().logout();
        },
        onServerEpoch: (epoch) => {
          void (async () => {
            const previous = await storageGet(STORAGE_KEYS.serverEpoch);
            if (previous && previous !== epoch) {
              // 服务端进程重启：重置本地投影并重新拉快照（离线队列保留）
              const activeConvId = useChatStore.getState().activeConvId;
              useChatStore.getState().reset();
              await useChatStore
                .getState()
                .loadConversations()
                .catch(() => undefined);
              if (activeConvId) {
                await useChatStore
                  .getState()
                  .loadMessages(activeConvId)
                  .catch(() => undefined);
              }
            }
            await storageSet(STORAGE_KEYS.serverEpoch, epoch);
          })();
        },
      },
    });
    setPullHandler((convId, fromSeq) => client?.pullMessages(convId, fromSeq));
    client.connect();
  })();
}

export function disconnectRealtime(): void {
  generation++;
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

// 浏览器恢复联网时立即重放离线队列；WS 重连本身也会触发 flush。
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void client?.flushOutbox().catch(() => undefined);
  });
}
