import { Avatar as BaseAvatar } from '@base-ui/react/avatar';
import { avatarColor, avatarForeground, initials } from '@chappie/shared';
import { cn } from '@/lib/utils';

interface UserAvatarProps {
  name: string;
  url?: string | null;
  className?: string;
  /** 分身头像使用会话强调色 tint */
  variant?: 'human' | 'avatar' | 'group';
}

function UserAvatar({ name, url, className }: UserAvatarProps) {
  // 分身与真人共用同一底色；AI 身份通过角标/机器人图标区分，而不是另一套背景。
  return (
    <BaseAvatar.Root
      style={{ backgroundColor: avatarColor(name), color: avatarForeground(name) }}
      className={cn(
        'relative flex size-8 shrink-0 select-none items-center justify-center overflow-hidden rounded-full text-[12px] font-semibold tracking-normal',
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
