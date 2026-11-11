import { RiCloseLine } from '@remixicon/react';
import { create } from 'zustand';
import { cn } from '@/lib/utils';

export interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: 'default' | 'success' | 'destructive';
}

interface ToastStore {
  toasts: ToastItem[];
  push: (t: Omit<ToastItem, 'id'>) => void;
  dismiss: (id: number) => void;
}

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
    }, 4200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = {
  show: (title: string, description?: string) =>
    useToastStore.getState().push({ title, description, variant: 'default' }),
  success: (title: string, description?: string) =>
    useToastStore.getState().push({ title, description, variant: 'success' }),
  error: (title: string, description?: string) =>
    useToastStore.getState().push({ title, description, variant: 'destructive' }),
};

const variantLine: Record<ToastItem['variant'], string> = {
  default: 'border-l-brand',
  success: 'border-l-success',
  destructive: 'border-l-destructive',
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'glass pointer-events-auto animate-bubble-in rounded-md border border-l-2 border-line p-3 shadow-pop',
            variantLine[t.variant],
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[13px] font-medium">{t.title}</div>
              {t.description ? (
                <div className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                  {t.description}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="rounded-sm p-0.5 text-ink-quaternary transition-colors hover:bg-surface-hover hover:text-ink"
              aria-label="关闭"
            >
              <RiCloseLine className="size-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
