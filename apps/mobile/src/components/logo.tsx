import { SvgXml } from 'react-native-svg';

/** Chappie 品牌 Logo（与根目录 logo.svg 同源）：缺口圆环 + 双眼，品牌蓝 #378ADD。 */
const LOGO_XML = `<svg viewBox="88 28 204 204" xmlns="http://www.w3.org/2000/svg"><path d="M269.7 123 A80 80 0 1 1 235.9 64.5" fill="none" stroke="#378ADD" stroke-width="26" stroke-linecap="round"/><circle cx="166" cy="130" r="12" fill="#378ADD"/><circle cx="214" cy="130" r="12" fill="#378ADD"/></svg>`;

export function Logo({ width = 120 }: { width?: number }) {
  return <SvgXml xml={LOGO_XML} width={width} height={width} />;
}
