/** 存储适配器：注入式适配（Web/Tauri 用 localStorage，RN 注入 AsyncStorage）。 */
import { describe, expect, test } from 'bun:test';
import {
  STORAGE_KEYS,
  type StorageLike,
  setStorageAdapter,
  storageGet,
  storageRemove,
  storageSet,
} from '../src/storage';

function memoryAdapter(): StorageLike & { dump: Map<string, string> } {
  const dump = new Map<string, string>();
  return {
    dump,
    getItem: (k) => dump.get(k) ?? null,
    setItem: (k, v) => void dump.set(k, v),
    removeItem: (k) => void dump.delete(k),
  };
}

describe('storage 适配器', () => {
  test('未注入适配器时使用内存兜底（读写/删除可用）', async () => {
    // 本文件第一个用例：此时尚未注入任何适配器
    await storageSet('fallback.key', 'v1');
    expect(await storageGet('fallback.key')).toBe('v1');
    await storageRemove('fallback.key');
    expect(await storageGet('fallback.key')).toBeNull();
  });

  test('注入同步适配器后读写走适配器', async () => {
    const adapter = memoryAdapter();
    setStorageAdapter(adapter);
    await storageSet('k', 'v');
    expect(adapter.dump.get('k')).toBe('v');
    expect(await storageGet('k')).toBe('v');
    await storageRemove('k');
    expect(await storageGet('k')).toBeNull();
  });

  test('支持异步适配器（React Native AsyncStorage）', async () => {
    const dump = new Map<string, string>();
    setStorageAdapter({
      getItem: async (k) => dump.get(k) ?? null,
      setItem: async (k, v) => void dump.set(k, v),
      removeItem: async (k) => void dump.delete(k),
    });
    await storageSet('async', '1');
    expect(await storageGet('async')).toBe('1');
    await storageRemove('async');
    expect(await storageGet('async')).toBeNull();
  });

  test('存储键带 chappie 前缀，避免与宿主应用冲突', () => {
    for (const key of Object.values(STORAGE_KEYS)) {
      expect(key.startsWith('chappie.')).toBe(true);
    }
  });
});
