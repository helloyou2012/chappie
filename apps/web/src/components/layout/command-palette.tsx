import { api, type ContactView, useAuthStore, useChatStore } from '@chappie/shared';
import {
  RiCalendarTodoLine,
  RiChat3Line,
  RiContactsLine,
  RiFileChartLine,
  RiGroupLine,
  RiLogoutBoxRLine,
  RiMoonLine,
  RiRobot2Line,
  RiSearchLine,
  RiShieldCheckLine,
  RiSunLine,
} from '@remixicon/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toggleTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const OPEN_EVENT = 'chappie:command';

/** 打开全局命令面板（⌘K / Ctrl+K） */
export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

/**
 * 全局命令面板：会话 / 联系人 / 页面跳转 / 主题与账户。
 * 键盘：↑↓ 选择，Enter 打开，Esc 关闭。
 */
export function CommandPalette() {
  const navigate = useNavigate();
  const conversations = useChatStore((s) => s.conversations);
  const logout = useAuthStore((s) => s.logout);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [contacts, setContacts] = useState<ContactView[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const show = useCallback(() => {
    setQuery('');
    setActive(0);
    setOpen(true);
    void api
      .listContacts()
      .then((r) => setContacts(r.contacts))
      .catch(() => setContacts([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) close();
        else show();
      } else if (e.key === 'Escape' && open) {
        close();
      }
    };
    const onOpen = () => show();
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [close, open, show]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const q = query.trim().toLowerCase();
    const match = (...fields: (string | null | undefined)[]) =>
      !q || fields.some((f) => (f ?? '').toLowerCase().includes(q));

    const convItems: PaletteItem[] = conversations
      .filter((v) => match(v.displayTitle, v.lastMsgPreview))
      .slice(0, 8)
      .map((v) => ({
        id: `conv:${v.conversation.id}`,
        group: '会话',
        label: v.displayTitle,
        hint: v.lastMsgPreview ?? '暂无消息',
        icon:
          v.conversation.systemTag === 'avatar_self' ? (
            <RiRobot2Line className="size-4 text-brand" />
          ) : v.conversation.type === 'group' ? (
            <RiGroupLine className="size-4" />
          ) : (
            <RiChat3Line className="size-4" />
          ),
        run: () => navigate(`/chat/${v.conversation.id}`),
      }));

    const contactItems: PaletteItem[] = contacts
      .filter((c) => match(c.user.name, c.user.email, c.alias))
      .slice(0, 6)
      .map((c) => ({
        id: `contact:${c.user.id}`,
        group: '联系人',
        label: c.alias?.trim() || c.user.name,
        hint: `与 ${c.user.name} 发起单聊`,
        icon: <RiContactsLine className="size-4" />,
        run: () => {
          void api
            .createConversation({ type: 'direct', memberUserIds: [c.user.id] })
            .then((res) => navigate(`/chat/${res.view.conversation.id}`))
            .catch(() => undefined);
        },
      }));

    const navItems: PaletteItem[] = [
      {
        id: 'nav:contacts',
        group: '跳转',
        label: '联系人',
        icon: <RiContactsLine className="size-4" />,
        run: () => navigate('/contacts'),
      },
      {
        id: 'nav:approvals',
        group: '跳转',
        label: '审批中心',
        icon: <RiShieldCheckLine className="size-4" />,
        run: () => navigate('/approvals'),
      },
      {
        id: 'nav:avatar',
        group: '跳转',
        label: '分身控制台',
        icon: <RiRobot2Line className="size-4" />,
        run: () => navigate('/avatar'),
      },
      {
        id: 'nav:schedule',
        group: '跳转',
        label: '日程与待办',
        icon: <RiCalendarTodoLine className="size-4" />,
        run: () => navigate('/schedule'),
      },
      {
        id: 'nav:reports',
        group: '跳转',
        label: '分身日报',
        icon: <RiFileChartLine className="size-4" />,
        run: () => navigate('/reports'),
      },
      {
        id: 'action:theme',
        group: '操作',
        label: '切换主题',
        icon: document.documentElement.classList.contains('dark') ? (
          <RiSunLine className="size-4" />
        ) : (
          <RiMoonLine className="size-4" />
        ),
        run: () => toggleTheme(),
      },
      {
        id: 'action:logout',
        group: '操作',
        label: '退出登录',
        icon: <RiLogoutBoxRLine className="size-4" />,
        run: () => {
          void logout().then(() => navigate('/login'));
        },
      },
    ].filter((i) => match(i.label));

    return [...convItems, ...contactItems, ...navItems];
  }, [conversations, contacts, query, navigate, logout]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const runItem = (item: PaletteItem | undefined) => {
    if (!item) return;
    close();
    item.run();
  };

  const groups = [...new Set(items.map((i) => i.group))];
  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]">
      <button
        type="button"
        aria-label="关闭命令面板"
        onClick={close}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        className="relative w-full max-w-lg overflow-hidden rounded-xl border border-line bg-popover text-popover-foreground shadow-panel"
      >
        <div className="flex items-center gap-2 border-b border-line px-3.5">
          <RiSearchLine className="size-4 shrink-0 text-ink-tertiary" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, items.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                runItem(items[active]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
            placeholder="搜索会话、联系人，或跳转…"
            className="h-11 w-full bg-transparent text-[14px] text-ink placeholder:text-ink-quaternary focus-visible:outline-none"
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink-tertiary">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="scrollbar-thin max-h-[46vh] overflow-y-auto p-1.5">
          {items.length === 0 ? (
            <p className="py-10 text-center text-[12px] text-ink-tertiary">没有匹配结果</p>
          ) : (
            groups.map((group) => (
              <div key={group}>
                <p className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-ink-quaternary">
                  {group}
                </p>
                {items
                  .filter((i) => i.group === group)
                  .map((item) => {
                    flatIndex += 1;
                    const idx = flatIndex;
                    return (
                      <button
                        type="button"
                        key={item.id}
                        data-index={idx}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => runItem(item)}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                          idx === active ? 'bg-surface-raised' : 'hover:bg-surface-veil',
                        )}
                      >
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-secondary">
                          {item.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-ink">{item.label}</span>
                          {item.hint ? (
                            <span className="block truncate text-[11px] text-ink-tertiary">
                              {item.hint}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-line px-3.5 py-2 text-[10px] text-ink-quaternary">
          <span>↑↓ 选择</span>
          <span>Enter 打开</span>
          <span>Esc 关闭</span>
          <span className="ml-auto font-mono">⌘K</span>
        </div>
      </div>
    </div>
  );
}
