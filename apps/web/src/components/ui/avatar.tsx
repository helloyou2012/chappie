import { Avatar as BaseAvatar } from '@base-ui/react/avatar';
import { initials } from '@chappie/shared';
import { cn } from '@/lib/utils';

interface UserAvatarProps {
  name: string;
  url?: string | null;
  className?: string;
  /** 分身头像使用会话强调色 tint */
  variant?: 'human' | 'avatar' | 'group';
}

const variantClass: Record<string, string> = {
  human: 'bg-surface-raised text-ink-secondary',
  avatar: 'bg-agent-tint text-agent',
  group: 'bg-surface-raised text-ink-tertiary',
};

function UserAvatar({ name, url, className, variant = 'human' }: UserAvatarProps) {
  return (
    <BaseAvatar.Root
      className={cn(
        'relative flex size-8 shrink-0 select-none items-center justify-center overflow-hidden rounded-full text-[11px] font-medium tracking-normal',
        variantClass[variant],
        className,
      )}
    >
      {url ? <BaseAvatar.Image src={url} alt={name} className="size-full object-cover" /> : null}
      <BaseAvatar.Fallback className="flex size-full items-center justify-center">
        {initials(name)}
      </BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
}

export { BaseAvatar, UserAvatar };
