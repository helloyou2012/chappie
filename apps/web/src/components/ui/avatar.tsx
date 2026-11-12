import { Avatar as BaseAvatar } from '@base-ui/react/avatar';
import { avatarColor, initials } from '@chappie/shared';
import { cn } from '@/lib/utils';

interface UserAvatarProps {
  name: string;
  url?: string | null;
  className?: string;
  /** 分身头像使用会话强调色 tint */
  variant?: 'human' | 'avatar' | 'group';
}

const variantClass: Record<string, string> = {
  human: '',
  avatar: 'ring-1 ring-white/20',
  group: 'ring-1 ring-white/10',
};

function UserAvatar({ name, url, className, variant = 'human' }: UserAvatarProps) {
  return (
    <BaseAvatar.Root
      style={{ backgroundColor: avatarColor(name), color: '#ffffff' }}
      className={cn(
        'relative flex size-8 shrink-0 select-none items-center justify-center overflow-hidden rounded-full text-[12px] font-semibold tracking-normal',
        variantClass[variant],
        className,
      )}
    >
      {url ? <BaseAvatar.Image src={url} alt={name} className="size-full object-cover" /> : null}
      <BaseAvatar.Fallback className="flex size-full items-center justify-center text-white">
        {initials(name)}
      </BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
}

export { BaseAvatar, UserAvatar };
