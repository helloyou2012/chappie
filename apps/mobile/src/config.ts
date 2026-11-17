/**
 * 移动端构建期配置（Expo `EXPO_PUBLIC_*`，构建时静态注入）。
 *
 * 服务地址不应由终端用户在界面上配置：生产构建通过环境变量固定，
 * 开发构建才在登录页/个人页暴露临时切换入口（`__DEV__`）。
 */
import { DEFAULT_ADMIN_URL, DEFAULT_SERVER_URL } from '@chappie/shared';

/** `EXPO_PUBLIC_SERVER_URL` 未配置时回退到同源 / 本机默认值 */
export const BUILD_SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL || DEFAULT_SERVER_URL;
export const BUILD_ADMIN_URL = process.env.EXPO_PUBLIC_ADMIN_URL || DEFAULT_ADMIN_URL;
