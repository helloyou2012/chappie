/**
 * 移动端推送：Expo Push token 注册（分身卡片 → APNs/FCM 触达）。
 *
 * 流程：权限请求 → 获取 ExpoPushToken → REST /api/v1/devices 覆盖式注册。
 * 失败全部静默降级（不影响登录/聊天）；每次前台回切会重新注册（token 可能轮换）。
 */

import { APP_VERSION, api, defaultMobileCapabilities, getOrCreateDeviceId } from '@chappie/shared';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

let registered = false;

/** 配置前台通知展示（仅在用户允许后） */
async function configureForeground(): Promise<void> {
  await Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** 注册推送：best-effort，失败静默。返回是否成功拿到并上报了 token。 */
export async function registerForPush(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const settings = await Notifications.getPermissionsAsync();
    let granted = settings.granted;
    if (!granted && settings.canAskAgain) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted;
    }
    if (!granted) return false;

    await configureForeground();
    const token = await Notifications.getExpoPushTokenAsync({ projectId: undefined });
    const pushToken = token.data;
    if (!pushToken) return false;

    const deviceId = await getOrCreateDeviceId();
    await api.registerDevice({
      deviceId,
      platform: Platform.OS === 'android' ? 'android' : 'ios',
      appVersion: APP_VERSION,
      capabilities: { ...defaultMobileCapabilities(), notifications: true },
      pushToken,
    });
    registered = true;
    return true;
  } catch {
    // 未配置 projectId / 模拟器等场景拿不到 token：静默降级
    return false;
  }
}

/** 登录成功后调用；已注册过则幂等跳过（可用 force 强制重注册）。返回是否已上报 token。 */
export async function ensurePushRegistered(force = false): Promise<boolean> {
  if (registered && !force) return true;
  return registerForPush();
}
