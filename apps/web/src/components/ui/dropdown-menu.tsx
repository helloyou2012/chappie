import { Menu as BaseMenu } from '@base-ui/react/menu';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const DropdownMenu = BaseMenu.Root;
const DropdownMenuTrigger = BaseMenu.Trigger;

function DropdownMenuContent({
  className,
  align = 'end',
  children,
  ...props
}: React.ComponentProps<typeof BaseMenu.Popup> & { align?: 'start' | 'center' | 'end' }) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner sideOffset={6} align={align} className="z-50">
        <BaseMenu.Popup
          className={cn(
            'glass min-w-40 rounded-md border border-line p-1 text-popover-foreground shadow-pop outline-none transition-all duration-150 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0',
            className,
          )}
          {...props}
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof BaseMenu.Item>) {
  return (
    <BaseMenu.Item
      className={cn(
        'flex h-7.5 cursor-default select-none items-center gap-2 rounded-md px-2 text-[13px] text-ink-secondary outline-none transition-colors data-[highlighted]:bg-surface-hover data-[highlighted]:text-ink data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof BaseMenu.Separator>) {
  return <BaseMenu.Separator className={cn('-mx-1 my-1 h-px bg-line', className)} {...props} />;
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
