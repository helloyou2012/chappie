import { cn } from '@/lib/utils';

function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<'hr'> & { orientation?: 'horizontal' | 'vertical' }) {
  return (
    <hr
      aria-orientation={orientation}
      className={cn(
        'm-0 shrink-0 border-0 bg-line',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
