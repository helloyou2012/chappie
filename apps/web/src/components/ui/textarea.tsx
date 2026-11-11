import type * as React from 'react';
import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'flex min-h-[64px] w-full rounded-md border border-line bg-elevated/60 px-2.5 py-2 text-[13px] leading-relaxed text-ink transition-colors placeholder:text-ink-quaternary focus-visible:border-[color-mix(in_srgb,var(--brand)_55%,transparent)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
