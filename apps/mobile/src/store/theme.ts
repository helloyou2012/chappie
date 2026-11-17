/**
 * 主题偏好：跟随系统 / 浅色 / 深色，持久化到本地（与 Web 端共用 `chappie.theme` key）。
 */
import { STORAGE_KEYS, storageGet, storageSet } from '@chappie/shared';
import { create } from 'zustand';

export type ThemeMode = 'system' | 'light' | 'dark';

function parseMode(raw: string | null): ThemeMode {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

interface ThemeState {
  mode: ThemeMode;
  hydrated: boolean;
  setMode: (mode: ThemeMode) => Promise<void>;
  restore: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: 'system',
  hydrated: false,
  setMode: async (mode) => {
    set({ mode });
    await storageSet(STORAGE_KEYS.theme, mode);
  },
  restore: async () => {
    const raw = await storageGet(STORAGE_KEYS.theme);
    set({ mode: parseMode(raw), hydrated: true });
  },
}));
