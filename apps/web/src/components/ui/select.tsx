import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const selectVariants = cva(
  'w-full rounded-md border border-line bg-elevated/60 text-ink transition-colors focus-visible:border-[color-mix(in_srgb,var(--brand)_55%,transparent)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      selectSize: {
        // 与 Button 的 default / sm 高度一致
        default: 'h-8 px-2.5 text-[13px]',
        sm: 'h-7 px-2 text-[12px]',
      },
    },
    defaultVariants: { selectSize: 'default' },
  },
);

export interface SelectProps
  extends React.ComponentProps<'select'>,
    VariantProps<typeof selectVariants> {}

function Select({ className, selectSize, ...props }: SelectProps) {
  return <select className={cn(selectVariants({ selectSize }), className)} {...props} />;
}

export { Select, selectVariants };
