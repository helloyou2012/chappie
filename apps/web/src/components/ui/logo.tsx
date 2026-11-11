import { cn } from '@/lib/utils';

/**
 * Chappie 品牌 Logo（源自根目录 logo.svg）：
 * 右上角带缺口的圆环 + 双眼，颜色可由 `--logo-color` 覆盖（默认品牌蓝 #378ADD）。
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="88 28 204 204"
      role="img"
      aria-label="Chappie"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('block', className)}
    >
      <path
        d="M269.7 123 A80 80 0 1 1 235.9 64.5"
        stroke="var(--logo-color, #378ADD)"
        strokeWidth={26}
        strokeLinecap="round"
      />
      <circle cx="166" cy="130" r="12" fill="var(--logo-color, #378ADD)" />
      <circle cx="214" cy="130" r="12" fill="var(--logo-color, #378ADD)" />
    </svg>
  );
}
