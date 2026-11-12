/**
 * 头像 duotone 色板。
 *
 * 每组 5 色：浅底 / 浅中间色 / 主色 / 次色 / 深次色。
 * 头像取「主色 + 深次色」做深色渐变，白色首字保证对比度；
 * 移动端取最深色作为纯色底。颜色按名称稳定哈希分配。
 */
export const DUOTONE_PALETTES = [
  // Indigo + Violet
  ['#EDE7F6', '#9575CD', '#5E35B1', '#7E57C2', '#512DA8'],
  // Teal + Blue
  ['#E0F7FA', '#4DD0E1', '#00ACC1', '#66A8FF', '#0066E6'],
  // Purple + Pink
  ['#F3E5F5', '#CE93D8', '#8E24AA', '#FF8FA3', '#FF1744'],
  // Orange + Pink
  ['#FFF3E0', '#FFCC80', '#FF9100', '#FFCDD2', '#EF5350'],
  // Green + Teal
  ['#E8F5E9', '#66BB6A', '#2E7D32', '#4DB6AC', '#00897B'],
  // Warm gradient (Yellow + Orange)
  ['#FFFDE7', '#FFEB3B', '#F9A825', '#FFA726', '#FF6D00'],
  // Sunset (Orange + Purple)
  ['#FFF0E5', '#FFB566', '#FF9329', '#AB47BC', '#6A1B9A'],
  // Ocean (Blue + Teal)
  ['#E3F2FD', '#64B5F6', '#1976D2', '#4DB6AC', '#00796B'],
  // Berry (Pink + Purple)
  ['#FCE4EC', '#F48FB1', '#E91E63', '#BA68C8', '#7B1FA2'],
  // Autumn (Orange + Red)
  ['#FFF3E0', '#FFB74D', '#FF6F00', '#EF5350', '#C62828'],
  // Lavender (Purple + Teal)
  ['#F3E5F5', '#BA68C8', '#8E24AA', '#4DD0E1', '#00838F'],
  // Coral (Pink + Orange)
  ['#FFEBEE', '#FF8A80', '#FF5252', '#FFAB40', '#FF6F00'],
  // Midnight (Deep Blue + Purple)
  ['#E8EAF6', '#5C6BC0', '#3F51B5', '#7B1FA2', '#4A148C'],
  // Rose Gold (Pink + Peach)
  ['#FFF5F5', '#F8BBD0', '#E91E63', '#FFAB91', '#FF8A65'],
  // Tropical (Yellow + Green)
  ['#F9FBE7', '#DCE775', '#C0CA33', '#81C784', '#4CAF50'],
  // Amethyst (Purple + Indigo)
  ['#F3E5F5', '#E1BEE7', '#9C27B0', '#7986CB', '#3F51B5'],
  // Flame (Red + Orange)
  ['#FFEBEE', '#EF9A9A', '#F44336', '#FF8A65', '#FF6E40'],
  // Sky (Light Blue + Cyan)
  ['#E1F5FE', '#81D4FA', '#03A9F4', '#4DD0E1', '#00BCD4'],
  // Forest (Deep Green + Teal)
  ['#E8F5E9', '#66BB6A', '#2E7D32', '#26A69A', '#00695C'],
  // Dusk (Purple + Blue)
  ['#EDE7F6', '#B39DDB', '#673AB7', '#5C6BC0', '#3949AB'],
] as const;

export type DuotonePalette = (typeof DUOTONE_PALETTES)[number];

/** 取色 key：只取首字母/首字，英文统一大写。 */
export function avatarInitial(name: string): string {
  return (Array.from(name.trim())[0] ?? '?').toUpperCase();
}

function hashName(name: string): number {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash;
}

/** 按首字母稳定选择一组 duotone 色板：同首字母 = 同色。 */
export function avatarPalette(name: string): DuotonePalette {
  return DUOTONE_PALETTES[hashName(avatarInitial(name)) % DUOTONE_PALETTES.length];
}

/** 将十六进制颜色压暗，保证白色文字的可读性。 */
function darken(hex: string, amount: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = Math.round(((value >> 16) & 0xff) * (1 - amount));
  const g = Math.round(((value >> 8) & 0xff) * (1 - amount));
  const b = Math.round((value & 0xff) * (1 - amount));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

/** 头像双色：主色 + 深次色，均做适度压暗。 */
export function avatarColors(name: string): { from: string; to: string } {
  const palette = avatarPalette(name);
  return {
    from: darken(palette[2], 0.22),
    to: darken(palette[4], 0.22),
  };
}

/** 头像背景：取每组最深色作为纯色底。 */
export function avatarColor(name: string): string {
  return avatarColors(name).to;
}
