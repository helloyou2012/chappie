import {
  APP_VERSION,
  CommandOutbox,
  defaultMobileCapabilities,
  getOrCreateDeviceId,
  RealtimeClient,
  STORAGE_KEYS,
  setPullHandler,
  storageGet,
  storageSet,
  useAuthStore,
  useChatStore,
  wsUrlFromServerUrl,
} from '@chappie/shared';
import { Platform } from 'react-native';

let client: RealtimeClient | null = null;
let generation = 0;

export function connectRealtime(): void {
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
      platform: Platform.OS === 'android' ? 'android' : Platform.OS === 'web' ? 'web' : 'ios',
      device: {
        deviceId,
        appVersion: APP_VERSION,
        capabilities: defaultMobileCapabilities(),
      },
      outbox: new CommandOutbox(user?.id ?? 'anonymous'),
      handlers: {
        onFrame: (frame) => useChatStore.getState().applyServerFrame(frame),
        onStatus: () => undefined,
        onAuthError: () => {
          void useAuthStore.getState().logout();
        },
        onServerEpoch: (epoch) => {
          void (async () => {
            const previous = await storageGet(STORAGE_KEYS.serverEpoch);
            if (previous && previous !== epoch) {
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

export function realtime(): RealtimeClient | null {
  return client;
}

/** 回到前台时调用：连接已断开则重连，否则直接重放离线队列。 */
export function resumeRealtime(): void {
  if (!client || !client.isOpen) {
    connectRealtime();
  } else {
    void client.flushOutbox().catch(() => undefined);
  }
}
