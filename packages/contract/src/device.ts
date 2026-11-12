/**
 * 设备与端侧能力契约。
 *
 * 端云一体的关键：云端知道「这台设备能做什么」，客户端知道「云端需要什么」。
 * 能力清单由客户端在鉴权时上报，云端只读；端侧动作仍走同一套权限/审批/审计。
 */
import { z } from 'zod';

export const DevicePlatform = z.enum(['web', 'desktop', 'ios', 'android']);
export type DevicePlatform = z.infer<typeof DevicePlatform>;

export const DeviceCapabilities = z.object({
  /** 可以接收本地通知 */
  notifications: z.boolean().default(false),
  /** 可以拍照/录像 */
  camera: z.boolean().default(false),
  /** 可以访问相册 */
  photoLibrary: z.boolean().default(false),
  /** 可以选择/读写文件 */
  files: z.boolean().default(false),
  /** 可以读写剪贴板 */
  clipboard: z.boolean().default(false),
  /** 可以获取地理位置 */
  location: z.boolean().default(false),
  /** 可以访问局域网设备 */
  localNetwork: z.boolean().default(false),
  /** 可以调用系统分享 */
  share: z.boolean().default(false),
  /** 可以使用生物识别 */
  biometrics: z.boolean().default(false),
});
export type DeviceCapabilities = z.infer<typeof DeviceCapabilities>;

export const DeviceRegistration = z.object({
  deviceId: z.string().min(1),
  platform: DevicePlatform,
  appVersion: z.string().default(''),
  capabilities: DeviceCapabilities.default({}),
  /** 推送 token（APNs/FCM/Expo 等），由客户端在获得权限后上报 */
  pushToken: z.string().nullable().optional(),
});
export type DeviceRegistration = z.infer<typeof DeviceRegistration>;

/** 云端返回的设备视图（内部接口/控制台用） */
export const DeviceView = z.object({
  deviceId: z.string(),
  platform: z.string(),
  appVersion: z.string().default(''),
  capabilities: DeviceCapabilities,
  pushToken: z.string().nullable().default(null),
  updatedAt: z.string(),
});
export type DeviceView = z.infer<typeof DeviceView>;
