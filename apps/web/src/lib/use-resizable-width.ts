import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readWidth(key: string, initial: number, min: number, max: number): number {
  if (typeof window === 'undefined') return initial;
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(parsed) ? clamp(parsed, min, max) : initial;
  } catch {
    return initial;
  }
}

export function useResizableWidth(opts: {
  storageKey: string;
  initial: number;
  min: number;
  max: number;
  /** 从右向左拖拽时使用（右侧面板） */
  invert?: boolean;
}): {
  width: number;
  onHandlePointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
} {
  const [width, setWidth] = useState(() =>
    readWidth(opts.storageKey, opts.initial, opts.min, opts.max),
  );
  const widthRef = useRef(width);

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  // 窗口变窄时把宽度收回合法区间
  useEffect(() => {
    const onResize = () => {
      setWidth((w) => {
        const next = clamp(w, opts.min, opts.max);
        widthRef.current = next;
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [opts.min, opts.max]);

  const onHandlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    const handle = e.currentTarget;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // 某些环境不支持 pointer capture，window 监听仍然可用
    }

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      const next = clamp(startWidth + (opts.invert ? -delta : delta), opts.min, opts.max);
      widthRef.current = next;
      setWidth(next);
    };

    const finish = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        window.localStorage.setItem(opts.storageKey, String(widthRef.current));
      } catch {
        // localStorage 不可用时仅本会话生效
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  return { width, onHandlePointerDown };
}
