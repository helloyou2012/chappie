/** 结构化日志（trace_id 贯穿 消息 → 事件 → 任务 → 工具调用 —— 设计方案 §32）。 */
import { v7 as uuidv7 } from 'uuid';
import { dayjs } from './datetime';

type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  const entry = {
    ts: dayjs().toISOString(),
    level,
    service: 'ai-platform',
    msg,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};

export function newTraceId(): string {
  return `trace_${uuidv7()}`;
}

/** 业务 ID（uuid v7：时间有序，利于索引与排序） */
export function newId(prefix: string): string {
  return `${prefix}_${uuidv7()}`;
}
