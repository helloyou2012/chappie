import { dayjs } from '@chappie/shared';
import { RiArrowDownSLine, RiArrowLeftSLine, RiArrowRightSLine } from '@remixicon/react';
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { type Dayjs, dateKey, monthGridDays, monthLabel, WEEKDAY_LABELS } from './calendar-utils';

interface MiniCalendarProps {
  /** 当前选中日期 */
  cursor: Dayjs;
  /** 小日历展示的月份（当月 1 日） */
  month: Dayjs;
  /** 有日程的日期集合，用于显示圆点 */
  eventDates: Set<string>;
  onMonthChange: (month: Dayjs) => void;
  onSelectDay: (day: Dayjs) => void;
}

/**
 * 左侧迷你月历：月份切换、今天高亮、选中日期与打点。
 * 点击日期跳转到对应「日」视图。
 */
export function MiniCalendar({
  cursor,
  month,
  eventDates,
  onMonthChange,
  onSelectDay,
}: MiniCalendarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const days = useMemo(() => monthGridDays(month), [month]);
  const today = dayjs();
  const cursorKey = dateKey(cursor);

  return (
    <div className="select-none">
      <div className="flex h-8 items-center justify-between pl-0.5 pr-1">
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex h-7 items-center gap-1 rounded-md px-1 text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
          aria-expanded={!collapsed}
          aria-label={collapsed ? '展开月历' : '收起月历'}
        >
          <RiArrowDownSLine
            className={cn(
              'size-4 text-ink-tertiary transition-transform duration-200',
              collapsed && '-rotate-90',
            )}
          />
          <span className="text-[13px] font-semibold tabular-nums tracking-[-0.01em]">
            {monthLabel(month)}
          </span>
        </button>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onMonthChange(month.subtract(1, 'month'))}
            className="flex size-6 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink"
            aria-label="上个月"
          >
            <RiArrowLeftSLine className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onMonthChange(month.add(1, 'month'))}
            className="flex size-6 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink"
            aria-label="下个月"
          >
            <RiArrowRightSLine className="size-4" />
          </button>
        </div>
      </div>

      {!collapsed ? (
        <>
          <div className="mt-1 grid grid-cols-7">
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="flex h-6 items-center justify-center text-[11px] text-ink-quaternary"
              >
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-px">
            {days.map((day) => {
              const key = dateKey(day);
              const inMonth = day.month() === month.month();
              const isToday = day.isSame(today, 'day');
              const isSelected = key === cursorKey;
              const hasEvents = eventDates.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelectDay(day)}
                  className="group relative flex h-8 items-center justify-center rounded-md transition-colors hover:bg-surface-hover"
                  aria-label={day.format('YYYY年M月D日')}
                  aria-current={isToday ? 'date' : undefined}
                >
                  <span
                    className={cn(
                      'flex size-7 items-center justify-center rounded-full text-[12px] tabular-nums transition-colors',
                      isToday && 'bg-brand font-medium text-primary-foreground',
                      !isToday && isSelected && 'bg-surface-selected text-ink',
                      !isToday && !isSelected && inMonth && 'text-ink-secondary',
                      !isToday && !isSelected && !inMonth && 'text-ink-quaternary',
                    )}
                  >
                    {day.date()}
                  </span>
                  {hasEvents ? (
                    <span
                      className={cn(
                        'absolute bottom-0.5 size-1 rounded-full',
                        isToday ? 'bg-brand' : 'bg-brand/55',
                      )}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
