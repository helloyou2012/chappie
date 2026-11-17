import { nameInitial } from './pinyin';

/**
 * 头像色板 —— 16 色（提取自 Avatar Color Generator）。
 *
 * 紫 / 蓝 / 青 / 绿 / 橄榄 / 琥珀 / 棕 / 橙红 / 粉 / 洋红 / 酒红，饱和度中等。
 * 圆形头像取纯色底，首字颜色按背景亮度自适应（深底白字 / 浅底深墨），
 * 对比度 ≥ 4.5:1。按首字母稳定哈希分配，Web 与移动端共用。
 */
export const AVATAR_COLORS = [
  '#692DE7', // 紫
  '#223BC9', // 蓝
  '#25667F', // 石板蓝
  '#2DE6C5', // 青
  '#22CA96', // 青绿
  '#25AE26', // 绿
  '#226E32', // 深绿
  '#70DF1F', // 黄绿
  '#9CEB38', // 亮黄绿
  '#9EA826', // 橄榄
  '#E6912B', // 琥珀
  '#A26123', // 棕
  '#EA5533', // 橙红
  '#D92181', // 粉
  '#A9249D', // 洋红
  '#992364', // 酒红
] as const;

export type AvatarColor = (typeof AVATAR_COLORS)[number];

const LIGHT_INK = '#FFFFFF';
const DARK_INK = '#141414';

/** 展示用首字：取名称首字符并大写（中文保留原字）。 */
export function avatarInitial(name: string): string {
  return (Array.from(name.trim())[0] ?? '?').toUpperCase();
}

/**
 * 取色 key：大写首字母。
 * 英文取 A–Z；中文取拼音首字母（周 → Z、王 → W）；数字/符号归入 #。
 * 同一首字母 = 同一颜色。
 */
export function avatarColorKey(name: string): string {
  return nameInitial(name);
}

/** 按大写首字母稳定选择背景色。 */
export function avatarColor(name: string): AvatarColor {
  const key = avatarColorKey(name);
  return AVATAR_COLORS[(key.charCodeAt(0) ?? 0) % AVATAR_COLORS.length];
}

function relativeLuminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (n: number) => {
    const c = n / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((value >> 16) & 0xff) +
    0.7152 * channel((value >> 8) & 0xff) +
    0.0722 * channel(value & 0xff)
  );
}

function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 首字颜色：在白色与深墨之间选对比更高的一侧。 */
export function avatarForeground(name: string): string {
  const background = avatarColor(name);
  return contrast(background, LIGHT_INK) >= contrast(background, DARK_INK) ? LIGHT_INK : DARK_INK;
}
