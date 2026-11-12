import { useAuthStore } from '@chappie/shared';
import {
  CalendarDaysIcon,
  ChatBubbleLeftRightIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { RiLogoutBoxRLine, RiMoonLine, RiRobot2Line, RiSunLine } from '@remixicon/react';
import type { ComponentType } from 'react';
import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { UserAvatar } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Logo } from '@/components/ui/logo';
import { toggleTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

interface RailItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const ITEMS: RailItem[] = [
  { to: '/chat', label: '聊天', icon: ChatBubbleLeftRightIcon },
  { to: '/approvals', label: '审批', icon: ShieldCheckIcon },
  { to: '/avatar', label: '分身', icon: RiRobot2Line },
  { to: '/reports', label: '日报', icon: CalendarDaysIcon },
];

/**
 * 最左侧独立图标栏：品牌、主导航、主题与用户菜单。
 * 与会话列表栏分离，顶部不再承载导航。
 */
export function IconRail() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [theme, setTheme] = useState<'light' | 'dark'>(
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  );
  const isMacDesktop =
    typeof window !== 'undefined' &&
    '__TAURI_INTERNALS__' in window &&
    typeof navigator !== 'undefined' &&
    /Mac/i.test(navigator.platform || navigator.userAgent);

  return (
    <aside
      data-tauri-drag-region
      className={cn(
        'relative mx-1.5 flex w-15 shrink-0 flex-col items-center gap-1 pb-3',
        isMacDesktop ? 'pt-10' : 'pt-3',
      )}
    >
      <Link
        to="/chat"
        aria-label="Chappie"
        className="mb-3 flex h-10 w-14 items-center justify-center"
      >
        <Logo className="h-8 w-8" />
      </Link>

      <nav data-tauri-drag-region className="flex flex-col items-center gap-1">
        {ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            title={label}
            aria-label={label}
            className={({ isActive }) =>
              cn(
                'flex w-14 flex-col items-center gap-1 rounded-xl py-2 text-[11px] leading-none transition-colors duration-150',
                isActive
                  ? 'bg-panel text-ink shadow-card'
                  : 'text-ink-tertiary hover:bg-surface-veil hover:text-ink',
              )
            }
          >
            <Icon className="size-5" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div data-tauri-drag-region className="flex-1" />

      <button
        type="button"
        onClick={() => setTheme(toggleTheme() === 'dark' ? 'dark' : 'light')}
        className="flex w-14 flex-col items-center gap-1 rounded-xl py-2 text-[11px] leading-none text-ink-quaternary transition-colors hover:bg-surface-veil hover:text-ink"
        aria-label="切换主题"
        title="切换主题"
      >
        {theme === 'dark' ? <RiSunLine className="size-5" /> : <RiMoonLine className="size-5" />}
        <span>主题</span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="mt-1 rounded-full transition-opacity hover:opacity-80"
              aria-label="账户菜单"
            />
          }
        >
          <UserAvatar name={user?.name ?? '?'} className="size-9" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <div className="px-2 py-1.5">
            <div className="truncate text-[13px] font-medium text-ink">{user?.name}</div>
            <div className="truncate text-[11px] text-ink-tertiary">{user?.email}</div>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate('/avatar')}>
            <RiRobot2Line /> 分身控制台
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              void logout().then(() => navigate('/login'));
            }}
          >
            <RiLogoutBoxRLine /> 退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </aside>
  );
}
