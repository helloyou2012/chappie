import { RiAddLine } from '@remixicon/react';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  type Dayjs,
  dateKey,
  formatMinutes,
  monthGridDays,
  type ScheduleEvent,
  WEEKDAY_LABELS,
} from './calendar-utils';

const MAX_VISIBLE_EVENTS = 3;

interface MonthGridProps {
  month: Dayjs;
  now: Dayjs;
  eventsByDay: Map<string, ScheduleEvent[]>;
  onSelectDay: (day: Dayjs) => void;
  onSelectEvent: (event: ScheduleEvent) => void;
  /** 单元格右上角「+」：以该日期新建日程 */
  onCreateAt: (day: Dayjs) => void;
}

/**
 * 月视图：6×7 网格，今天用品牌色圆点标记，单元格内最多展示 3 条日程。
 */
export function MonthGrid({
  month,
  now,
  eventsByDay,
  onSelectDay,
  onSelectEvent,
  onCreateAt,
}: MonthGridProps) {
  const days = useMemo(() => monthGridDays(month), [month]);
  const rows = useMemo(
    () => Array.from({ length: 6 }, (_, row) => days.slice(row * 7, row * 7 + 7)),
    [days],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-line">
        {WEEKDAY_LABELS.map((label, index) => (
          <div
            key={label}
            className={cn(
              'flex h-9 items-center justify-center text-[11px]',
              index === now.day() ? 'text-brand' : 'text-ink-tertiary',
            )}
          >
            周{label}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-6">
        {rows.map((rowDays, rowIndex) => {
          const isCurrentWeek = rowDays.some((day) => day.isSame(now, 'day'));
          return (
            <div
              key={rowDays[0] ? dateKey(rowDays[0]) : rowIndex}
              className={cn('grid min-h-0 grid-cols-7', isCurrentWeek && 'bg-surface-veil/50')}
            >
              {rowDays.map((day, colIndex) => {
                const key = dateKey(day);
                const inMonth = day.month() === month.month();
                const isToday = day.isSame(now, 'day');
                const dayEvents = eventsByDay.get(key) ?? [];
                const visible = dayEvents.slice(0, MAX_VISIBLE_EVENTS);
                const overflow = dayEvents.length - visible.length;

                return (
                  <div
                    key={key}
                    className={cn(
                      'group relative flex min-h-0 flex-col overflow-hidden border-b border-line/60 px-1 pb-0.5 pt-1 transition-colors hover:bg-surface-veil',
                      colIndex > 0 && 'border-l border-line/60',
                      !inMonth && 'bg-surface-veil/30',
                    )}
                  >
                    <button
                      type="button"
                      aria-label={`查看 ${day.format('M月D日')} 的日程`}
                      onClick={() => onSelectDay(day)}
                      className="absolute inset-0 z-0 cursor-pointer"
                    />
                    <div className="pointer-events-none relative z-[1] flex min-h-0 flex-1 flex-col">
                      <div className="flex h-6 shrink-0 items-center justify-between gap-1">
                        <span
                          className={cn(
                            'flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[12px] tabular-nums',
                            isToday && 'bg-brand px-1.5 font-medium text-primary-foreground',
                            !isToday && inMonth && 'text-ink-secondary',
                            !isToday && !inMonth && 'text-ink-quaternary',
                          )}
                        >
                          {day.date() === 1 ? day.format('M月D日') : day.date()}
                        </span>
                        <button
                          type="button"
                          aria-label={`${day.format('M月D日')} 新建日程`}
                          onClick={() => onCreateAt(day)}
                          className="pointer-events-auto flex size-5 shrink-0 items-center justify-center rounded text-ink-quaternary opacity-0 transition-colors hover:bg-surface-hover hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
                        >
                          <RiAddLine className="size-3.5" />
                        </button>
                      </div>

                      <div className="mt-0.5 flex min-h-0 flex-1 flex-col gap-px overflow-hidden">
                        {visible.map((event) => (
                          <button
                            key={event.key}
                            type="button"
                            onClick={() => onSelectEvent(event)}
                            className="pointer-events-auto flex h-[18px] w-full shrink-0 items-center gap-1 overflow-hidden rounded px-0.5 text-left text-[11px] text-ink-secondary transition-colors hover:bg-surface-hover"
                            title={`${event.title}，${event.startMin == null ? event.rawTime : formatMinutes(event.startMin)}`}
                          >
                            <span className="size-1.5 shrink-0 rounded-full bg-brand/75" />
                            {event.startMin == null ? null : (
                              <span className="shrink-0 tabular-nums text-ink-tertiary">
                                {formatMinutes(event.startMin)}
                              </span>
                            )}
                            <span className="truncate">{event.title}</span>
                          </button>
                        ))}
                        {overflow > 0 ? (
                          <button
                            type="button"
                            onClick={() => onSelectDay(day)}
                            className="pointer-events-auto w-fit rounded px-1 text-left text-[10px] text-ink-tertiary hover:text-ink"
                          >
                            +{overflow} 更多
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
