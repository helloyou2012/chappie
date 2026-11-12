/**
 * 设备身份与端侧能力探测。
 *
 * 端侧能力只做「声明」：真正的动作仍由云端决策，并走同一套权限/审批/审计。
 * 探测结果必须保守：拿不准的能力填 false，宁可让云端少做，也不要让现场失败。
 */

import type { DeviceCapabilities, DevicePlatform } from '@chappie/contract';
import { uuid } from './format';
import { storageGet, storageSet } from './storage';

export const APP_VERSION = '0.1.0';
const DEVICE_ID_KEY = 'chappie.deviceId';

/** 设备 id 持久化：同一浏览器/安装包始终使用同一个 id。 */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await storageGet(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = `dev_${uuid()}`;
  await storageSet(DEVICE_ID_KEY, id);
  return id;
}

export function emptyCapabilities(): DeviceCapabilities {
  return {
    notifications: false,
    camera: false,
    photoLibrary: false,
    files: false,
    clipboard: false,
    location: false,
    localNetwork: false,
    share: false,
    biometrics: false,
  };
}

/** 浏览器端能力探测（保守：只声明当前 API 确实存在的能力）。 */
export function detectWebCapabilities(): DeviceCapabilities {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return emptyCapabilities();
  }
  const nav = navigator as unknown as {
    mediaDevices?: { getUserMedia?: unknown };
    clipboard?: unknown;
    geolocation?: unknown;
    share?: unknown;
  };
  const win = window as unknown as {
    Notification?: unknown;
    File?: unknown;
    FileReader?: unknown;
    PublicKeyCredential?: unknown;
  };
  return {
    notifications: typeof win.Notification !== 'undefined',
    camera: typeof nav.mediaDevices?.getUserMedia === 'function',
    photoLibrary: typeof win.FileReader !== 'undefined',
    files: typeof win.File !== 'undefined',
    clipboard: nav.clipboard !== undefined,
    location: nav.geolocation !== undefined,
    localNetwork: false,
    share: typeof nav.share === 'function',
    biometrics: typeof win.PublicKeyCredential !== 'undefined',
  };
}

/**
 * 移动端默认能力：原生壳通常具备相机/相册/文件/剪贴板/定位/分享/生物识别。
 * 通知需要用户授权，默认 false，授权后由 App 覆盖。
 */
export function defaultMobileCapabilities(): DeviceCapabilities {
  return {
    notifications: false,
    camera: true,
    photoLibrary: true,
    files: true,
    clipboard: true,
    location: true,
    localNetwork: false,
    share: true,
    biometrics: true,
  };
}

export function platformFromRuntime(
  platform: 'web' | 'desktop' | 'ios' | 'android',
): DevicePlatform {
  return platform;
}
