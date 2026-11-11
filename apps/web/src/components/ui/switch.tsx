import { Switch as BaseSwitch } from '@base-ui/react/switch';
import type * as React from 'react';
import { cn } from '@/lib/utils';

function Switch({ className, ...props }: React.ComponentProps<typeof BaseSwitch.Root>) {
  return (
    <BaseSwitch.Root
      className={cn(
        'peer inline-flex h-[18px] w-[30px] shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:bg-primary data-[unchecked]:bg-surface-selected',
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb className="pointer-events-none block size-3.5 rounded-full bg-white ring-0 transition-transform data-[checked]:translate-x-3 data-[unchecked]:translate-x-0" />
    </BaseSwitch.Root>
  );
}

export { Switch };
