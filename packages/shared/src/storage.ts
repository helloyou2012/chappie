/**
 * 存储适配器：Web/Tauri 用 localStorage，React Native 注入 AsyncStorage。
 * 不依赖 DOM，保证 shared 包在移动端可复用。
 */

export interface StorageLike {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

let storage: StorageLike | null = null;

export function setStorageAdapter(adapter: StorageLike): void {
  storage = adapter;
}

export function getStorage(): StorageLike {
  if (!storage) {
    // 兜底：内存存储（SSR / 测试 / 未配置适配器时）
    const mem = new Map<string, string>();
    storage = {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    };
  }
  return storage;
}

export async function storageGet(key: string): Promise<string | null> {
  return (await getStorage().getItem(key)) ?? null;
}

export async function storageSet(key: string, value: string): Promise<void> {
  await getStorage().setItem(key, value);
}

export async function storageRemove(key: string): Promise<void> {
  await getStorage().removeItem(key);
}

export const STORAGE_KEYS = {
  token: 'chappie.token',
  user: 'chappie.user',
  serverUrl: 'chappie.serverUrl',
  adminUrl: 'chappie.adminUrl',
  draftPrefix: 'chappie.draft.',
  serverEpoch: 'chappie.serverEpoch',
} as const;
