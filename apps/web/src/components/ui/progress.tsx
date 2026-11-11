import { Progress as BaseProgress } from '@base-ui/react/progress';
import type * as React from 'react';
import { cn } from '@/lib/utils';

function Progress({ className, value, ...props }: React.ComponentProps<typeof BaseProgress.Root>) {
  return (
    <BaseProgress.Root className={cn('', className)} value={value} {...props}>
      <BaseProgress.Track className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
        <BaseProgress.Indicator className="h-full rounded-full bg-primary transition-all" />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}

export { Progress };
