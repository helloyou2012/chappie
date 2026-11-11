import type * as React from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-8 w-full rounded-md border border-line bg-elevated/60 px-2.5 text-[13px] text-ink transition-colors placeholder:text-ink-quaternary focus-visible:border-[color-mix(in_srgb,var(--brand)_55%,transparent)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
