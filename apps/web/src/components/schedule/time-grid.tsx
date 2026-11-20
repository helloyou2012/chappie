import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  DAY_HEIGHT,
  type Dayjs,
  dateKey,
  formatMinutes,
  HOUR_HEIGHT,
  MINUTE_STEP,
  type ScheduleEvent,
  timezoneLabel,
  WEEKDAY_LABELS,
} from './calendar-utils';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface PlacedEvent {
  event: ScheduleEvent;
  column: number;
  columns: number;
}

/**
 * 时间重叠布局：把互相重叠的日程分组，组内按列并排。
 * 例如 13:50–14:20 与 14:00–14:30 会变成左右两列，而不是文字叠在一起。
 */
function layoutDayEvents(events: ScheduleEvent[]): PlacedEvent[] {
  const sorted = events
    .filter((event) => event.startMin != null && event.endMin != null)
    .sort((a, b) => a.startMin! - b.startMin! || (a.endMin ?? 0) - (b.endMin ?? 0));

  const placed: PlacedEvent[] = [];
  let group: ScheduleEvent[] = [];
  let groupEnd = -1;

  const flush = () => {
    if (group.length === 0) return;
    const columns: ScheduleEvent[][] = [];
    const columnOf = new Map<string, number>();
    for (const event of group) {
      let column = 0;
      while (
        columns[column] &&
        columns[column]![columns[column]!.length - 1]!.endMin! > event.startMin!
      ) {
        column += 1;
      }
      if (!columns[column]) columns[column] = [];
      columns[column]!.push(event);
      columnOf.set(event.key, column);
    }
    for (const event of group) {
      placed.push({
        event,
        column: columnOf.get(event.key) ?? 0,
        columns: columns.length,
      });
    }
    group = [];
  };

  for (const event of sorted) {
    if (group.length > 0 && event.startMin! >= groupEnd) {
      flush();
      groupEnd = -1;
    }
    group.push(event);
    groupEnd = Math.max(groupEnd, event.endMin!);
  }
  flush();
  return placed;
}

interface TimeGridProps {
  /** 日视图 1 天 / 周视图 7 天 */
  days: Dayjs[];
  eventsByDay: Map<string, ScheduleEvent[]>;
  now: Dayjs;
  onSelectEvent: (event: ScheduleEvent) => void;
  onCreateAt: (day: Dayjs, minute: number) => void;
}

/**
 * 日 / 周视图共用时间轴：
 * 左侧小时刻度 + 右侧按天分列，日程按开始时间绝对定位，当前时间红线横贯。
 */
export function TimeGrid({ days, eventsByDay, now, onSelectEvent, onCreateAt }: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nowTop = ((now.hour() * 60 + now.minute()) / 60) * HOUR_HEIGHT;
  const containsToday = days.some((day) => day.isSame(now, 'day'));
  const todayIndex = days.findIndex((day) => day.isSame(now, 'day'));
  const anchor = `${days[0]?.format('YYYY-MM-DD') ?? ''}-${days.length}`;
  const isWeek = days.length > 1;

  // 切换日期 / 视图时滚动到当前时间附近；分钟跳动不重复滚动
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在锚点日期变化时定位滚动
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const raw = containsToday ? nowTop - 2 * HOUR_HEIGHT : 7 * HOUR_HEIGHT;
    // 对齐到整点，并让出顶部 sticky 的 GMT+8 标签高度
    const target = Math.floor(raw / HOUR_HEIGHT) * HOUR_HEIGHT - 32;
    el.scrollTop = Math.max(0, target);
  }, [anchor]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {isWeek ? (
        <div className="flex shrink-0 border-b border-line">
          <div className="w-16 shrink-0" />
          <div className="flex min-w-0 flex-1">
            {days.map((day) => {
              const isToday = day.isSame(now, 'day');
              return (
                <div
                  key={dateKey(day)}
                  className="flex min-w-0 flex-1 flex-col items-center gap-0.5 border-l border-line/60 py-1.5"
                >
                  <span className={cn('text-[11px]', isToday ? 'text-brand' : 'text-ink-tertiary')}>
                    周{WEEKDAY_LABELS[day.day()]}
                  </span>
                  <span
                    className={cn(
                      'flex size-8 items-center justify-center rounded-full text-[17px] font-medium tabular-nums',
                      isToday ? 'text-brand' : 'text-ink-secondary',
                    )}
                  >
                    {day.date()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div ref={scrollRef} className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto">
        <div className="relative flex" style={{ height: DAY_HEIGHT }}>
          {/* 小时刻度槽 */}
          <div className="relative w-16 shrink-0">
            <span className="sticky top-0 z-20 flex h-6 items-center justify-end bg-view pr-2 text-[10px] tabular-nums text-ink-quaternary">
              {timezoneLabel()}
            </span>
            {HOURS.map((hour) =>
              hour === 0 ? null : (
                <span
                  key={hour}
                  className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-ink-tertiary"
                  style={{ top: hour * HOUR_HEIGHT }}
                >
                  {formatMinutes(hour * 60)}
                </span>
              ),
            )}
            {containsToday ? (
              <span
                className="absolute right-2 z-10 -translate-y-1/2 text-[11px] font-medium tabular-nums text-danger"
                style={{ top: nowTop }}
              >
                {now.format('HH:mm')}
              </span>
            ) : null}
          </div>

          {/* 日期列 */}
          <div className="relative flex min-w-0 flex-1">
            {days.map((day) => {
              const key = dateKey(day);
              const dayEvents = eventsByDay.get(key) ?? [];
              const isToday = day.isSame(now, 'day');
              return (
                <div
                  key={key}
                  className={cn(
                    'relative min-w-0 flex-1 border-l border-line/60',
                    isToday && 'bg-surface-veil/40',
                  )}
                >
                  {/* 空白处点击新建：键盘激活时落在 09:00 */}
                  <button
                    type="button"
                    aria-label={`在 ${day.format('M月D日')} 新建日程`}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      const y = event.detail === 0 ? 9 * HOUR_HEIGHT : event.clientY - rect.top;
                      const raw = (y / HOUR_HEIGHT) * 60;
                      const minute = Math.max(
                        0,
                        Math.min(23 * 60 + 30, Math.round(raw / MINUTE_STEP) * MINUTE_STEP),
                      );
                      onCreateAt(day, minute);
                    }}
                    className="absolute inset-0 z-0 w-full cursor-default"
                  />
                  {HOURS.map((hour) => (
                    <div
                      key={hour}
                      className="pointer-events-none absolute inset-x-0 border-t border-line/60"
                      style={{ top: hour * HOUR_HEIGHT }}
                    />
                  ))}

                  {layoutDayEvents(dayEvents).map(({ event, column, columns }) => {
                    const top = (event.startMin! / 60) * HOUR_HEIGHT + 1;
                    const height = Math.max(
                      24,
                      ((event.endMin! - event.startMin!) / 60) * HOUR_HEIGHT - 2,
                    );
                    const width = 100 / columns;
                    const timeRange = `${formatMinutes(event.startMin!)} - ${formatMinutes(
                      event.endMin!,
                    )}`;
                    return (
                      <button
                        key={event.key}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectEvent(event);
                        }}
                        className={cn(
                          'absolute z-10 overflow-hidden rounded-[5px] border-l-[3px] border-brand bg-brand-soft text-left text-brand shadow-[0_0_0_1px_var(--view)] transition-colors hover:z-20 hover:bg-[color-mix(in_srgb,var(--brand)_20%,transparent)]',
                          isWeek ? 'px-1 text-[11px]' : 'px-2 text-[12px]',
                        )}
                        style={{
                          top,
                          height,
                          left: `calc(${column * width}% + 1px)`,
                          width: `calc(${width}% - 2px)`,
                        }}
                        title={`${event.title}，${timeRange}`}
                      >
                        <span className="block truncate leading-[1.35]">
                          {event.status === 'pending'
                            ? '待批准 · '
                            : event.status === 'cancelled'
                              ? '已取消 · '
                              : ''}
                          {event.title}
                        </span>
                        {height >= 34 ? (
                          <span className="block truncate text-[10px] leading-[1.3] opacity-70">
                            {timeRange}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}

            {containsToday ? (
              <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: nowTop }}>
                <div className="h-px w-full bg-danger" />
                <span
                  className="absolute -top-1 size-1.5 -translate-x-1/2 rounded-full bg-danger"
                  style={{
                    left:
                      todayIndex >= 0 && isWeek
                        ? `${((todayIndex + 0.5) / days.length) * 100}%`
                        : 0,
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
