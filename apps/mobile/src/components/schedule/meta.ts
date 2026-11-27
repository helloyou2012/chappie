/** 日程视图共享常量与状态映射（页面 / 网格 / 行 / 详情抽屉共用）。 */
export type ScheduleTab = 'calendar' | 'todo';

export const HOUR_HEIGHT = 48;
export const START_HOUR = 7;
export const END_HOUR = 23;
export const GUTTER = 46;
export const GRID_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
export const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 时间轴左上角的时区标签（GMT+8 / GMT-5 / GMT+5.5），按设备时区计算。 */
export const TZ_LABEL = (() => {
  const hours = -new Date().getTimezoneOffset() / 60;
  return `GMT${hours >= 0 ? '+' : '-'}${Math.abs(hours)}`;
})();

export const STATUS_META: Record<
  string,
  { label: string; tone: 'muted' | 'success' | 'warning' | 'danger' }
> = {
  pending: { label: '待批准', tone: 'warning' },
  confirmed: { label: '已确认', tone: 'success' },
  cancelled: { label: '已取消', tone: 'muted' },
};

export function topOf(minutes: number): number {
  return ((minutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
}
