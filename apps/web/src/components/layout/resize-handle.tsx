import type { PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@/lib/utils';

/**
 * 可拖拽的栏宽分隔条。
 * 命中区 8px，视觉线 1px；悬停/拖拽时显示上下渐隐的竖线。
 */
export function ResizeHandle({
  side,
  onPointerDown,
  label,
}: {
  side: 'left' | 'right';
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  label: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      className={cn(
        'group absolute inset-y-0 z-30 w-2 touch-none cursor-col-resize',
        side === 'right' ? '-right-1' : '-left-1',
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none m-auto h-full w-px opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-active:opacity-100"
        style={{
          background:
            'linear-gradient(to bottom, transparent, color-mix(in srgb, var(--ink-primary) 25%, transparent), transparent)',
        }}
      />
    </div>
  );
}
