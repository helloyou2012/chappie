/**
 * Canonical JSON + SHA-256 —— 审批参数指纹与可复算审计的基础。
 *
 * 为什么不用普通 JSON.stringify：
 *   - 对象键顺序不稳定会让同一份参数得到不同指纹；
 *   - 审批卡展示、落库参数、执行参数必须能算出同一个 hash。
 *
 * 规则（算法版本 v1）：
 *   - 对象键按字典序排序；数组保持原序；
 *   - 对象的 undefined 键省略；数组中的 undefined 视为 null；
 *   - 字符串/数字/布尔/null 交给 JSON.stringify；
 *   - 非法数字（NaN/Infinity）与 JSON.stringify 一致，序列化为 null。
 */

export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .sort();
  const pairs = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`);
  return `{${pairs.join(',')}}`;
}

/** SHA-256 十六进制摘要（Bun 运行时内置，无需新增依赖）。 */
export function sha256Hex(text: string): string {
  return new Bun.CryptoHasher('sha256').update(text).digest('hex');
}

/** 带版本前缀的内容指纹，便于未来更换算法而不误判旧值。 */
export function fingerprint(version: string, value: unknown): string {
  return sha256Hex(`${version}|${canonicalJson(value)}`);
}
