/**
 * 移动端视觉令牌 —— 与 Web 端 `apps/web/src/index.css` 同源。
 * 规范：docs/ui-guidelines.md
 */
export const colors = {
  bg: '#f2f2f0',
  card: '#fcfcfb',
  text: '#0a0a0a',
  textMuted: 'rgba(10,10,10,0.56)',
  textTertiary: 'rgba(10,10,10,0.38)',
  border: 'rgba(10,10,10,0.1)',
  primary: '#6e56cf',
  primaryFg: '#ffffff',
  surfaceRaised: 'rgba(10,10,10,0.05)',
  surfaceHover: 'rgba(10,10,10,0.075)',
  aiBubble: 'rgba(84,185,166,0.12)',
  aiText: '#3d9c8a',
  bubble: 'rgba(10,10,10,0.045)',
  bubbleUser: '#111110',
  bubbleUserText: '#ffffff',
  agent: '#54b9a6',
  danger: '#d33a3a',
  success: '#1f8a65',
  warning: '#b7791f',
};

export const darkColors: typeof colors = {
  bg: '#0b0b0b',
  card: '#141414',
  text: '#f2f2f2',
  textMuted: 'rgba(255,255,255,0.58)',
  textTertiary: 'rgba(255,255,255,0.38)',
  border: 'rgba(255,255,255,0.12)',
  primary: '#8b7cf6',
  primaryFg: '#141414',
  surfaceRaised: 'rgba(255,255,255,0.03)',
  surfaceHover: 'rgba(255,255,255,0.05)',
  aiBubble: 'rgba(84,185,166,0.16)',
  aiText: '#8fd5c7',
  bubble: 'rgba(255,255,255,0.055)',
  bubbleUser: '#ecece8',
  bubbleUserText: '#141414',
  agent: '#54b9a6',
  danger: '#f87171',
  success: '#3dbd8a',
  warning: '#f0bf00',
};

/** 圆角梯度（与 Web 一致） */
export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  bubble: 16,
  pill: 999,
};

export const modeLabels: Record<string, string> = {
  manual: '手动',
  draft: '草稿',
  auto: '自动',
  off: '静默',
};

export type ThemeColors = typeof colors;
