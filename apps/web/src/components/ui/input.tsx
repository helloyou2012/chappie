import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const inputVariants = cva(
  'flex w-full rounded-md border border-line bg-elevated/60 text-ink transition-colors placeholder:text-ink-quaternary focus-visible:border-[color-mix(in_srgb,var(--brand)_55%,transparent)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      inputSize: {
        // 与 Button 的 default / sm 高度一致
        default: 'h-8 px-2.5 text-[13px]',
        sm: 'h-7 px-2 text-[12px]',
      },
    },
    defaultVariants: { inputSize: 'default' },
  },
);

export interface InputProps
  extends Omit<React.ComponentProps<'input'>, 'size'>,
    VariantProps<typeof inputVariants> {}

function Input({ className, type, inputSize, ...props }: InputProps) {
  return <input type={type} className={cn(inputVariants({ inputSize }), className)} {...props} />;
}

export { Input, inputVariants };
