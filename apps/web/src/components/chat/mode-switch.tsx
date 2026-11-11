import { MODE_DESCRIPTIONS, MODE_LABELS, useChatStore } from '@chappie/shared';
import { RiTimerLine } from '@remixicon/react';
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

const MODES = ['manual', 'draft', 'auto', 'off'] as const;

export function ModeSwitch({
  convId,
  mode,
  until,
}: {
  convId: string;
  mode: string;
  until: string | null;
}) {
  const update = useChatStore((s) => s.updateConversationMode);
  const [busy, setBusy] = useState(false);

  const change = async (next: string, tempHours?: number) => {
    setBusy(true);
    try {
      await update(convId, next as never, tempHours);
      toast.success(
        `分身档位：${MODE_LABELS[next]}`,
        tempHours ? `临时 ${tempHours} 小时，到期自动回落` : MODE_DESCRIPTIONS[next],
      );
    } catch (e) {
      toast.error('切换失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <div
        className="flex rounded-md bg-surface-veil p-0.5"
        role="radiogroup"
        aria-label="分身档位"
      >
        {MODES.map((m) => (
          <button
            type="button"
            key={m}
            role="radio"
            aria-checked={mode === m}
            disabled={busy}
            title={MODE_DESCRIPTIONS[m]}
            onClick={() => void change(m)}
            className={cn(
              'h-7 rounded-sm px-2.5 text-[12px] font-medium transition-colors disabled:opacity-60',
              mode === m ? 'bg-surface-raised text-ink' : 'text-ink-tertiary hover:text-ink',
            )}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" title="临时模式">
              <RiTimerLine className="size-3.5" />
            </Button>
          }
        />
        <DropdownMenuContent>
          <div className="px-2.5 py-1 text-[11px] font-medium text-ink-tertiary">
            临时档位（2 小时后自动回落）
          </div>
          {MODES.map((m) => (
            <DropdownMenuItem key={m} onClick={() => void change(m, 2)}>
              {MODE_LABELS[m]} · 2 小时
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {until ? (
        <Badge variant="warning" className="whitespace-nowrap">
          临时
        </Badge>
      ) : null}
    </div>
  );
}
