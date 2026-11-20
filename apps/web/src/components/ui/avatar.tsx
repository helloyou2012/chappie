import { Avatar as BaseAvatar } from '@base-ui/react/avatar';
import { avatarColor, avatarForeground, initials } from '@chappie/shared';
import { cn } from '@/lib/utils';

interface UserAvatarProps {
  name: string;
  url?: string | null;
  className?: string;
  /** 分身头像使用会话强调色 tint */
  variant?: 'human' | 'avatar' | 'group';
  /** 是否显示头像右下角 AI 角标；小头像或已有文字标签时关闭，避免遮挡 */
  showAiBadge?: boolean;
}

function UserAvatar({
  name,
  url,
  className,
  variant = 'human',
  showAiBadge = true,
}: UserAvatarProps) {
  // 分身与真人共用同一底色；AI 身份通过头像外的角标区分，而不是另一套背景。
  return (
    <span className={cn('relative inline-flex shrink-0 text-[12px]', className)}>
      <BaseAvatar.Root
        style={{ backgroundColor: avatarColor(name), color: avatarForeground(name) }}
        className="flex size-full select-none items-center justify-center overflow-hidden rounded-full font-semibold tracking-normal"
      >
        {url ? <BaseAvatar.Image src={url} alt={name} className="size-full object-cover" /> : null}
        <BaseAvatar.Fallback className="flex size-full items-center justify-center">
          {initials(name)}
        </BaseAvatar.Fallback>
      </BaseAvatar.Root>
      {variant === 'avatar' && showAiBadge ? (
        <span
          title="AI 分身"
          className="pointer-events-none absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full border-2 border-panel bg-brand text-[7px] leading-none font-semibold tracking-normal text-primary-foreground"
        >
          AI
        </span>
      ) : null}
    </span>
  );
}

export { BaseAvatar, UserAvatar };
