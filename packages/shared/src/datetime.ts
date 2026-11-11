/**
 * 日期工具（三端统一）：dayjs + relativeTime + 中文 locale。
 * 需要 UTC 语义时使用导出的 dayjs.utc()（见 ai 平台）。
 */
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.locale('zh-cn');

export { dayjs };
