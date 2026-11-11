/**
 * 宽容 JSON 解析（partial-json）。
 *
 * 适用场景（输入不保证严格合法）：
 *   - 模型输出的工具调用参数（可能被截断、缺少闭合括号，或带多余内容）
 *   - 用户手输的「修改后批准」JSON（可能不完整）
 *   - JSONB 列以字符串形式返回（Bun.sql 行为）
 *
 * 对完整 JSON 等价于 JSON.parse；无法解析时返回 undefined（由调用方决定降级）。
 * 注意：WS 帧、本地缓存等协议/内部数据仍使用严格 JSON.parse，避免掩盖错误。
 */
import { Allow, parse } from 'partial-json';

export function parseJsonSafe<T = unknown>(raw: string): T | undefined {
  try {
    return parse(raw, Allow.ALL) as T;
  } catch {
    return undefined;
  }
}
