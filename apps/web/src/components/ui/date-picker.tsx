import { Popover } from '@base-ui/react/popover';
import { dayjs } from '@chappie/shared';
import { RiArrowDownSLine, RiCalendarLine, RiTimeLine } from '@remixicon/react';
import { useEffect, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { zhCN } from 'react-day-picker/locale';
import 'react-day-picker/style.css';
import { cn } from '@/lib/utils';

interface DatePickerProps {
  /** YYYY-MM-DD；空串表示未选择 */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/** 日期选择：Base UI Popover + react-day-picker。 */
export function DatePicker({
  value,
  onChange,
  placeholder = '选择日期',
  disabled = false,
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = value && dayjs(value).isValid() ? dayjs(value).toDate() : undefined;
  const [month, setMonth] = useState<Date>(() => selected ?? new Date());

  useEffect(() => {
    if (value && dayjs(value).isValid()) setMonth(dayjs(value).toDate());
  }, [value]);

  return (
    <Popover.Root
      modal={false}
      open={open}
      onOpenChange={(next) => {
        if (next && selected) setMonth(selected);
        setOpen(next);
      }}
    >
      <Popover.Trigger
        disabled={disabled}
        render={
          <button
            type="button"
            disabled={disabled}
            className={cn(
              'flex h-8 w-full items-center gap-2 rounded-md border border-line bg-elevated/60 px-2.5 text-left text-[13px] text-ink transition-colors hover:border-line-strong focus-visible:border-[color-mix(in_srgb,var(--brand)_55%,transparent)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
              className,
            )}
          />
        }
      >
        <RiCalendarLine className="size-4 shrink-0 text-ink-tertiary" />
        <span className={cn('flex-1 truncate', !selected && 'text-ink-quaternary')}>
          {selected ? dayjs(selected).format('YYYY-MM-DD') : placeholder}
        </span>
        <RiArrowDownSLine className="size-3.5 shrink-0 text-ink-quaternary" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-50">
          <Popover.Popup className="rounded-md border border-line bg-popover p-2 text-popover-foreground shadow-pop outline-none">
            <DayPicker
              className="rdp-chappie"
              mode="single"
              selected={selected}
              month={month}
              onMonthChange={setMonth}
              onSelect={(date) => {
                if (!date) return;
                onChange(dayjs(date).format('YYYY-MM-DD'));
                setOpen(false);
              }}
              locale={zhCN}
              weekStartsOn={1}
              showOutsideDays
              captionLayout="dropdown"
              startMonth={dayjs().subtract(10, 'year').startOf('year').toDate()}
              endMonth={dayjs().add(10, 'year').endOf('year').toDate()}
            />
            <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
              <span className="text-[10px] text-ink-quaternary">
                {dayjs().format('YYYY年M月D日')}
              </span>
              <button
                type="button"
                onClick={() => {
                  onChange(dayjs().format('YYYY-MM-DD'));
                  setOpen(false);
                }}
                className="rounded-md bg-surface-veil px-2 py-1 text-[11px] font-medium text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
              >
                今天
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

interface TimePickerProps {
  /** HH:mm；空串时按 09:00 显示 */
  value: string;
  onChange: (value: string) => void;
  /** 分钟步长，默认 5 */
  minuteStep?: number;
  disabled?: boolean;
  className?: string;
}

function splitTime(value: string): [string, string] {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return ['09', '00'];
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.min(59, Math.max(0, Number(match[2])));
  return [String(hour).padStart(2, '0'), String(minute).padStart(2, '0')];
}

/** 时间选择：与日期选择器一致的下拉浮层，小时/分钟双列滚轮。 */
export function TimePicker({
  value,
  onChange,
  minuteStep = 5,
  disabled = false,
  className,
}: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const [hour, minute] = splitTime(value);
  const step = Math.max(1, Math.min(30, Math.round(minuteStep)));

  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) =>
    String(i * step).padStart(2, '0'),
  );
  if (!minutes.includes(minute)) {
    minutes.push(minute);
    minutes.sort();
  }

  return (
    <Popover.Root modal={false} open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        disabled={disabled}
        render={
          <button
            type="button"
            disabled={disabled}
            className={cn(
              'flex h-8 w-[126px] items-center gap-2 rounded-md border border-line bg-elevated/60 px-2.5 text-left text-[13px] text-ink tabular-nums transition-colors hover:border-line-strong focus-visible:border-[color-mix(in_srgb,var(--brand)_55%,transparent)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
              className,
            )}
          />
        }
      >
        <RiTimeLine className="size-4 shrink-0 text-ink-tertiary" />
        <span className="flex-1">
          {hour}:{minute}
        </span>
        <RiArrowDownSLine className="size-3.5 shrink-0 text-ink-quaternary" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} align="start" className="z-50">
          <Popover.Popup className="w-40 rounded-md border border-line bg-popover p-2 text-popover-foreground shadow-pop outline-none">
            <div className="mb-1 grid grid-cols-2 gap-1 text-center text-[10px] font-medium text-ink-tertiary">
              <span>小时</span>
              <span>分钟</span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <div className="scrollbar-thin flex max-h-52 flex-col gap-0.5 overflow-y-auto pr-1">
                {hours.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => onChange(`${h}:${minute}`)}
                    className={cn(
                      'h-7 shrink-0 rounded-md text-[12px] tabular-nums transition-colors',
                      h === hour
                        ? 'bg-brand text-primary-foreground'
                        : 'text-ink-secondary hover:bg-surface-hover hover:text-ink',
                    )}
                  >
                    {h}
                  </button>
                ))}
              </div>
              <div className="scrollbar-thin flex max-h-52 flex-col gap-0.5 overflow-y-auto pr-1">
                {minutes.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      onChange(`${hour}:${m}`);
                      setOpen(false);
                    }}
                    className={cn(
                      'h-7 shrink-0 rounded-md text-[12px] tabular-nums transition-colors',
                      m === minute
                        ? 'bg-brand text-primary-foreground'
                        : 'text-ink-secondary hover:bg-surface-hover hover:text-ink',
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-line pt-1">
              <span className="text-[10px] text-ink-quaternary">选择分钟后关闭</span>
              <button
                type="button"
                onClick={() => {
                  onChange(dayjs().format('HH:mm'));
                  setOpen(false);
                }}
                className="rounded-md bg-surface-veil px-2 py-1 text-[11px] font-medium text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
              >
                现在
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
