/** 认证状态：token / user / 服务地址；支持持久化恢复（Web localStorage / RN AsyncStorage）。 */

import type { SendCodeResponse, User } from '@chappie/contract';
import { create } from 'zustand';
import { ApiError, api, configureApi } from '../api';
import { DEFAULT_ADMIN_URL, DEFAULT_SERVER_URL } from '../constants';
import { STORAGE_KEYS, storageGet, storageRemove, storageSet } from '../storage';

export type AuthStatus = 'init' | 'ready' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  token: string | null;
  user: User | null;
  serverUrl: string;
  adminUrl: string;
  restoring: boolean;

  restore: () => Promise<void>;
  setServerUrl: (serverUrl: string, adminUrl?: string) => Promise<void>;
  sendCode: (email: string) => Promise<SendCodeResponse>;
  login: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

let configured = false;

function ensureConfigured(serverUrl: string, adminUrl: string) {
  configureApi({
    serverUrl,
    adminUrl,
    getToken: () => useAuthStore.getState().token,
    onUnauthorized: () => {
      void useAuthStore.getState().logout();
    },
  });
  configured = true;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'init',
  token: null,
  user: null,
  serverUrl: DEFAULT_SERVER_URL,
  adminUrl: DEFAULT_ADMIN_URL,
  restoring: false,

  restore: async () => {
    set({ restoring: true });
    const serverUrl = (await storageGet(STORAGE_KEYS.serverUrl)) ?? DEFAULT_SERVER_URL;
    const adminUrl = (await storageGet(STORAGE_KEYS.adminUrl)) ?? DEFAULT_ADMIN_URL;
    ensureConfigured(serverUrl, adminUrl);

    const token = await storageGet(STORAGE_KEYS.token);
    if (!token) {
      set({ status: 'unauthenticated', serverUrl, adminUrl, restoring: false });
      return;
    }
    // 先写入 store，configureApi 的 getToken 才能带上 Bearer 头（否则 me() 必然 401）
    set({ token });
    try {
      const me = await api.me();
      set({ token, user: me.user, status: 'ready', serverUrl, adminUrl, restoring: false });
    } catch (e) {
      // 只有在明确「未授权」时才清除令牌；网络/服务不可用时保留，
      // 避免服务器短暂重启就把用户踢下线。
      if (e instanceof ApiError && e.status === 401) {
        await storageRemove(STORAGE_KEYS.token);
        await storageRemove(STORAGE_KEYS.user);
        set({
          token: null,
          user: null,
          status: 'unauthenticated',
          serverUrl,
          adminUrl,
          restoring: false,
        });
        return;
      }
      try {
        const cached = await storageGet(STORAGE_KEYS.user);
        const user = cached ? (JSON.parse(cached) as User) : null;
        set({
          token,
          user,
          status: user ? 'ready' : 'unauthenticated',
          serverUrl,
          adminUrl,
          restoring: false,
        });
      } catch {
        set({
          token,
          user: null,
          status: 'unauthenticated',
          serverUrl,
          adminUrl,
          restoring: false,
        });
      }
    }
  },

  setServerUrl: async (serverUrl, adminUrl) => {
    const url = serverUrl.trim().replace(/\/$/, '');
    const aurl = (adminUrl ?? get().adminUrl).trim().replace(/\/$/, '');
    await storageSet(STORAGE_KEYS.serverUrl, url);
    await storageSet(STORAGE_KEYS.adminUrl, aurl);
    ensureConfigured(url, aurl);
    set({ serverUrl: url, adminUrl: aurl });
  },

  sendCode: (email) => {
    if (!configured) ensureConfigured(get().serverUrl, get().adminUrl);
    return api.sendCode(email);
  },

  login: async (email, code) => {
    if (!configured) ensureConfigured(get().serverUrl, get().adminUrl);
    const res = await api.verifyCode(email, code);
    await storageSet(STORAGE_KEYS.token, res.token);
    await storageSet(STORAGE_KEYS.user, JSON.stringify(res.user));
    set({ token: res.token, user: res.user, status: 'ready' });
  },

  logout: async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    await storageRemove(STORAGE_KEYS.token);
    await storageRemove(STORAGE_KEYS.user);
    set({ token: null, user: null, status: 'unauthenticated' });
  },
}));
