import {
  api,
  RECEPTION_LABELS,
  type ReceptionStrategy,
  type ReceptionView,
  STRATEGY_DESCRIPTIONS,
  STRATEGY_LABELS,
  useChatStore,
} from '@chappie/shared';
import { RiRobot2Line, RiTimerLine, RiUserLine } from '@remixicon/react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

const STRATEGIES: ReceptionStrategy[] = [
  'summon',
  'assist',
  'full',
  'screen',
  'decline',
  'escalate',
  'silent',
];

export function ModeSwitch({ convId, reception }: { convId: string; reception: ReceptionView }) {
  const loadConversations = useChatStore((s) => s.loadConversations);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    await loadConversations().catch(() => undefined);
  };

  const change = async (next: Partial<ReceptionView>, tempHours?: number) => {
    setBusy(true);
    try {
      const until = tempHours
        ? new Date(Date.now() + tempHours * 3600_000).toISOString()
        : next.until;
      await api.updateReception(convId, {
        state: next.state,
        strategy: next.strategy,
        until,
      });
      await refresh();
      toast.success(
        next.state === 'human'
          ? '已切回真人接待'
          : `分身接待：${STRATEGY_LABELS[next.strategy ?? reception.strategy]}`,
      );
    } catch (e) {
      toast.error('切换失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const takeover = async () => {
    setBusy(true);
    try {
      await api.takeover(convId);
      await refresh();
      toast.success('已接管', '分身已暂停，正在生成交接摘要');
    } catch (e) {
      toast.error('接管失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const release = async () => {
    setBusy(true);
    try {
      await api.release(convId);
      await refresh();
      toast.success('已交还分身', '分身将继续按当前策略接待');
    } catch (e) {
      toast.error('交还失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const isAvatar = reception.state === 'avatar';
  return (
    <div className="flex items-center gap-1.5">
      <Badge variant={isAvatar ? 'ai' : reception.state === 'paused' ? 'muted' : 'success'}>
        {isAvatar ? <RiRobot2Line className="size-2.5" /> : <RiUserLine className="size-2.5" />}
        {RECEPTION_LABELS[reception.state] ?? reception.state}
      </Badge>
      <div className="flex rounded-md bg-surface-veil p-0.5">
        <button
          type="button"
          aria-pressed={!isAvatar}
          disabled={busy}
          title="真人接待；分身仅在召唤/草稿时协助"
          onClick={() => void (isAvatar ? takeover() : change({ state: 'human' }))}
          className={cn(
            'h-7 rounded-sm px-2.5 text-[12px] font-medium transition-colors disabled:opacity-60',
            !isAvatar ? 'bg-surface-raised text-ink' : 'text-ink-tertiary hover:text-ink',
          )}
        >
          真人
        </button>
        <button
          type="button"
          aria-pressed={isAvatar}
          disabled={busy}
          title="分身接待"
          onClick={() => void (isAvatar ? release() : change({ state: 'avatar' }))}
          className={cn(
            'h-7 rounded-sm px-2.5 text-[12px] font-medium transition-colors disabled:opacity-60',
            isAvatar ? 'bg-surface-raised text-ink' : 'text-ink-tertiary hover:text-ink',
          )}
        >
          分身
        </button>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" title="接待策略" disabled={busy}>
              <RiTimerLine className="size-3.5" />
            </Button>
          }
        />
        <DropdownMenuContent className="w-64">
          <div className="px-2.5 py-1 text-[11px] font-medium text-ink-tertiary">接待策略</div>
          {STRATEGIES.map((s) => (
            <DropdownMenuItem
              key={s}
              onClick={() => void change({ state: 'avatar', strategy: s })}
              className={cn(reception.strategy === s && 'bg-surface-selected')}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="leading-tight">{STRATEGY_LABELS[s]}</span>
                <span className="text-[10px] leading-snug whitespace-normal text-ink-tertiary">
                  {STRATEGY_DESCRIPTIONS[s]}
                </span>
              </div>
            </DropdownMenuItem>
          ))}
          <div className="my-1 h-px bg-line" />
          <div className="px-2.5 py-1 text-[11px] font-medium text-ink-tertiary">
            临时托管（2 小时后回落）
          </div>
          <DropdownMenuItem onClick={() => void change({ state: 'avatar', strategy: 'full' }, 2)}>
            全权代答 · 2 小时
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void change({ state: 'avatar', strategy: 'silent' }, 2)}>
            静默值守 · 2 小时
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {reception.until ? (
        <Badge variant="warning" className="whitespace-nowrap">
          临时
        </Badge>
      ) : null}
    </div>
  );
}
