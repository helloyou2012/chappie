/**
 * 默认服务地址（可在登录页修改）。macOS AirPlay 占用 7000，网关默认 7100。
 *
 * 部署到域名时优先使用同源：反向代理把 /api、/ws、/admin 转发到对应服务。
 * 本地开发 / Tauri（tauri://localhost）/ React Native（无 location）仍回退到本机端口。
 */
function sameOriginBase(): string | null {
  if (typeof window === 'undefined') return null;
  const origin = window.location?.origin;
  if (!origin || !/^https?:/.test(origin)) return null;
  if (/localhost|127\.0\.0\.1/.test(origin)) return null;
  return origin;
}

const ORIGIN = sameOriginBase();
export const DEFAULT_SERVER_URL = ORIGIN ?? 'http://127.0.0.1:7100';
export const DEFAULT_ADMIN_URL = ORIGIN ?? 'http://127.0.0.1:7002';

export const MODE_LABELS: Record<string, string> = {
  manual: '手动',
  draft: '草稿',
  auto: '自动',
  off: '静默',
};

export const MODE_DESCRIPTIONS: Record<string, string> = {
  manual: '仅在被 @ 时响应',
  draft: '生成回复草稿，由你确认后发送',
  auto: '相关消息自主判断并回复',
  off: '分身完全不工作',
};

export const RISK_LABELS: Record<string, string> = {
  L0: '只读',
  L1: '低风险写',
  L2: '需确认',
  L3: '禁止',
};
