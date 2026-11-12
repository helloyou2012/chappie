import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const Tabs = BaseTabs.Root;

function TabsList({ className, ...props }: React.ComponentProps<typeof BaseTabs.List>) {
  return (
    <BaseTabs.List
      className={cn(
        'inline-flex h-8 items-center justify-center gap-0.5 rounded-md bg-surface-veil p-0.5 text-ink-tertiary',
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof BaseTabs.Tab>) {
  return (
    <BaseTabs.Tab
      className={cn(
        'inline-flex h-7 items-center justify-center whitespace-nowrap rounded-sm px-2.5 text-xs font-medium transition-colors hover:text-ink-secondary focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 aria-selected:bg-surface-selected aria-selected:text-ink aria-selected:hover:text-ink',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof BaseTabs.Panel>) {
  return <BaseTabs.Panel className={cn('mt-4 focus-visible:outline-none', className)} {...props} />;
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
