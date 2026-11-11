import {
  RealtimeClient,
  setPullHandler,
  useAuthStore,
  useChatStore,
  wsUrlFromServerUrl,
} from '@chappie/shared';

let client: RealtimeClient | null = null;

export function connectRealtime(): void {
  const { token, serverUrl, status } = useAuthStore.getState();
  if (!token || status !== 'ready') return;
  disconnectRealtime();
  client = new RealtimeClient({
    url: wsUrlFromServerUrl(serverUrl),
    token,
    platform: 'ios',
    handlers: {
      onFrame: (frame) => useChatStore.getState().applyServerFrame(frame),
      onStatus: () => undefined,
      onAuthError: () => {
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

export function realtime(): RealtimeClient | null {
  return client;
}
