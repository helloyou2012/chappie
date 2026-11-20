import {
  RiArrowDownSLine,
  RiCalendarLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiEditLine,
  RiLoader4Line,
  RiTimeLine,
  RiUserLine,
} from '@remixicon/react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DatePicker, TimePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  type CalendarStatus,
  eventRange,
  formatFullDate,
  type ScheduleEvent,
} from './calendar-utils';

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

            <div className="mt-4 space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <DatePicker value={date} onChange={onDateChange} />
                </div>
                <div>
                  <TimePicker value={time} onChange={onTimeChange} />
                </div>
              </div>
              <p className="px-1 text-[11px] text-ink-quaternary">默认时长 30 分钟</p>

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

const STATUS_LABELS: Record<CalendarStatus, string> = {
  pending: '待批准',
  confirmed: '已确认',
  cancelled: '已取消',
};

const STATUS_CLASS: Record<CalendarStatus, string> = {
  pending: 'bg-warning/15 text-warning',
  confirmed: 'bg-success/15 text-success',
  cancelled: 'bg-surface-veil text-ink-tertiary',
};

interface EventDetailDialogProps {
  event: ScheduleEvent | null;
  calendarName: string;
  deleting: boolean;
  statusChanging: boolean;
  onClose: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onStatusChange: (status: CalendarStatus) => void;
}

/** 日程详情：查看信息、修改状态或删除。 */
export function EventDetailDialog({
  event,
  calendarName,
  deleting,
  statusChanging,
  onClose,
  onDelete,
  onEdit,
  onStatusChange,
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
            <div className="flex items-center gap-2.5">
              <RiUserLine className="size-4 shrink-0 text-ink-tertiary" />
              <span className="truncate">
                {event.attendees.length > 0 ? event.attendees.join('、') : '未设置相关人'}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="w-4 shrink-0 text-center text-[11px] text-ink-tertiary">●</span>
              <span className="text-ink-tertiary">状态</span>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      disabled={statusChanging}
                      className={cn(
                        'inline-flex h-[18px] items-center gap-1 rounded-full px-1.5 text-[11px] font-medium transition-opacity disabled:opacity-60',
                        STATUS_CLASS[event.status],
                      )}
                      title="修改日程状态"
                    >
                      {STATUS_LABELS[event.status]}
                      <RiArrowDownSLine className="size-3" />
                    </button>
                  }
                />
                <DropdownMenuContent align="start" className="w-32">
                  {(Object.keys(STATUS_LABELS) as CalendarStatus[]).map((status) => (
                    <DropdownMenuItem
                      key={status}
                      disabled={event.status === status}
                      onClick={() => onStatusChange(status)}
                    >
                      <RiCheckLine
                        className={cn(
                          'size-3.5',
                          event.status === status ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      {STATUS_LABELS[status]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {statusChanging ? (
                <RiLoader4Line className="size-3.5 animate-spin text-ink-tertiary" />
              ) : null}
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
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onEdit}>
              <RiEditLine className="size-3.5" />
              编辑
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface EditEventDialogProps {
  event: ScheduleEvent | null;
  updating: boolean;
  onClose: () => void;
  onSave: (fields: {
    title: string;
    date: string | null;
    time: string;
    attendees: string[];
  }) => void;
}

/** 编辑日程：独立弹窗，只展示可编辑字段，使用白色不透明背景。 */
export function EditEventDialog({ event, updating, onClose, onSave }: EditEventDialogProps) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [attendees, setAttendees] = useState('');

  useEffect(() => {
    if (!event) return;
    setTitle(event.title);
    setDate(event.date ?? '');
    const parsed = /^(\d{1,2}):(\d{2})/.exec(event.rawTime.trim());
    setTime(
      parsed
        ? `${String(Math.min(23, Number(parsed[1]))).padStart(2, '0')}:${String(
            Math.min(59, Number(parsed[2])),
          ).padStart(2, '0')}`
        : '09:00',
    );
    setAttendees(event.attendees.join('，'));
  }, [event]);

  return (
    <Dialog open={event !== null} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-[380px] bg-popover">
        <div className="mb-4 flex flex-col gap-1">
          <DialogTitle className="text-[16px]">编辑日程</DialogTitle>
          <p className="text-[12px] text-muted-foreground">修改后会立即同步给分身</p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-ink-tertiary">标题</label>
            <Input
              autoFocus
              value={title}
              maxLength={100}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="日程标题"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-ink-tertiary">日期</label>
              <div>
                <DatePicker value={date} onChange={setDate} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-ink-tertiary">时间</label>
              <div>
                <TimePicker value={time} onChange={setTime} />
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-ink-tertiary">相关人</label>
            <Input
              value={attendees}
              onChange={(e) => setAttendees(e.target.value)}
              placeholder="用逗号分隔，如：Bob，小王"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={updating} onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={updating || !title.trim() || !time.trim()}
            onClick={() =>
              onSave({
                title: title.trim(),
                date: date.trim() || null,
                time: time.trim(),
                attendees: attendees
                  .split(/[,，、]/)
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
          >
            {updating ? <RiLoader4Line className="size-3.5 animate-spin" /> : null}
            保存修改
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
