import { RiCalendarLine, RiDeleteBinLine, RiLoader4Line, RiTimeLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { eventRange, formatFullDate, type ScheduleEvent } from './calendar-utils';

interface CreateEventDialogProps {
  open: boolean;
  title: string;
  date: string;
  time: string;
  calendarName: string;
  saving: boolean;
  onTitleChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

/**
 * 新建日程浮层。
 * 只提交后端支持的主题 / 日期 / 时间，不伪造与会人、会议室等字段。
 */
export function CreateEventDialog({
  open,
  title,
  date,
  time,
  calendarName,
  saving,
  onTitleChange,
  onDateChange,
  onTimeChange,
  onClose,
  onSubmit,
}: CreateEventDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-[440px] gap-0 p-0">
        <DialogTitle className="sr-only">新建日程</DialogTitle>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="px-5 pb-4 pt-5">
            <input
              autoFocus
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder="日程主题"
              maxLength={100}
              className="w-full bg-transparent text-[20px] font-semibold tracking-[-0.012em] text-ink outline-none placeholder:text-ink-quaternary"
            />

            <div className="mt-4 space-y-0.5">
              <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-veil">
                <RiCalendarLine className="size-4 shrink-0 text-ink-tertiary" />
                <input
                  type="date"
                  value={date}
                  onChange={(event) => onDateChange(event.target.value)}
                  aria-label="日期"
                  className="w-[128px] bg-transparent text-[13px] tabular-nums text-ink outline-none"
                />
                <span className="text-ink-quaternary">·</span>
                <RiTimeLine className="size-4 shrink-0 text-ink-tertiary" />
                <input
                  type="time"
                  value={time}
                  onChange={(event) => onTimeChange(event.target.value)}
                  aria-label="时间"
                  className="w-[84px] bg-transparent text-[13px] tabular-nums text-ink outline-none"
                />
                <span className="ml-auto text-[11px] text-ink-quaternary">
                  {time ? '时长 30 分钟' : '添加时间'}
                </span>
              </div>

              <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <span className="size-2.5 rounded-full bg-brand" />
                </span>
                <span className="truncate text-[13px] text-ink-secondary">{calendarName}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
            <span className="text-[11px] text-ink-quaternary">日程会同步给分身，到点主动提醒</span>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                取消
              </Button>
              <Button type="submit" size="sm" disabled={saving || !title.trim()}>
                {saving ? <RiLoader4Line className="size-3.5 animate-spin" /> : null}
                保存
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface EventDetailDialogProps {
  event: ScheduleEvent | null;
  calendarName: string;
  deleting: boolean;
  onClose: () => void;
  onDelete: () => void;
}

/** 日程详情：查看完整信息并删除（后端未提供更新接口） */
export function EventDetailDialog({
  event,
  calendarName,
  deleting,
  onClose,
  onDelete,
}: EventDetailDialogProps) {
  return (
    <Dialog open={event !== null} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-[380px]">
        <div className="mb-4 flex flex-col gap-1">
          <DialogTitle className="text-[16px]">{event?.title}</DialogTitle>
          <p className="text-[12px] text-muted-foreground">由分身与你共享的日程</p>
        </div>

        {event ? (
          <div className="space-y-2.5 text-[13px] text-ink-secondary">
            <div className="flex items-center gap-2.5">
              <RiCalendarLine className="size-4 shrink-0 text-ink-tertiary" />
              <span className="tabular-nums">{formatFullDate(event.date)}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <RiTimeLine className="size-4 shrink-0 text-ink-tertiary" />
              <span className="tabular-nums">{eventRange(event)}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="flex size-4 shrink-0 items-center justify-center">
                <span className="size-2.5 rounded-full bg-brand" />
              </span>
              <span className="truncate">{calendarName}</span>
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={deleting}
            onClick={onDelete}
            className="text-danger hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] hover:text-danger"
          >
            {deleting ? (
              <RiLoader4Line className="size-3.5 animate-spin" />
            ) : (
              <RiDeleteBinLine className="size-3.5" />
            )}
            删除日程
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
