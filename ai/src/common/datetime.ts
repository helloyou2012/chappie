/** 日期工具（ai-platform）：dayjs + utc 插件。与 PG 的 UTC 语义保持一致用 dayjs.utc()。 */
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

export { dayjs };
