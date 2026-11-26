import { useAuthStore } from '@chappie/shared';
import {
  CalendarDaysIcon,
  ChatBubbleLeftRightIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import {
  RiCalendarTodoLine,
  RiContactsLine,
  RiLogoutBoxRLine,
  RiMoonLine,
  RiRobot2Line,
  RiSunLine,
  RiUserSettingsLine,
} from '@remixicon/react';
import type { ComponentType } from 'react';
import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Logo } from '@/components/ui/logo';
import { toast } from '@/components/ui/toast';
import { toggleTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

interface RailItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const ITEMS: RailItem[] = [
  { to: '/chat', label: '聊天', icon: ChatBubbleLeftRightIcon },
  { to: '/contacts', label: '联系人', icon: RiContactsLine },
  { to: '/approvals', label: '审批', icon: ShieldCheckIcon },
  { to: '/avatar', label: '分身', icon: RiRobot2Line },
  { to: '/schedule', label: '日程', icon: RiCalendarTodoLine },
  { to: '/reports', label: '日报', icon: CalendarDaysIcon },
];

/**
 * 最左侧独立图标栏：品牌、主导航、主题与用户菜单。
 * 与会话列表栏分离，顶部不再承载导航。
 */
export function IconRail() {
  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const [profileOpen, setProfileOpen] = useState(false);
  const [jobRole, setJobRole] = useState(user?.jobRole ?? '');
  const [department, setDepartment] = useState(user?.department ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
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
          <DropdownMenuItem
            onClick={() => {
              setJobRole(user?.jobRole ?? '');
              setDepartment(user?.department ?? '');
              setProfileOpen(true);
            }}
          >
            <RiUserSettingsLine /> 个人资料
          </DropdownMenuItem>
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

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>个人资料</DialogTitle>
            <DialogDescription>职位和部门用于分身判断群聊里是否需要替主人接话。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
              职位
              <Input
                value={jobRole}
                maxLength={40}
                placeholder="如：产品经理"
                onChange={(e) => setJobRole(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
              部门
              <Input
                value={department}
                maxLength={60}
                placeholder="如：产品部"
                onChange={(e) => setDepartment(e.target.value)}
              />
            </label>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>取消</DialogClose>
            <Button
              disabled={savingProfile}
              onClick={() => {
                setSavingProfile(true);
                void updateProfile({
                  jobRole: jobRole.trim(),
                  department: department.trim(),
                })
                  .then(() => {
                    toast.success('已保存', '职位/部门已更新');
                    setProfileOpen(false);
                  })
                  .catch((e) => toast.error('保存失败', e instanceof Error ? e.message : String(e)))
                  .finally(() => setSavingProfile(false));
              }}
            >
              {savingProfile ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
