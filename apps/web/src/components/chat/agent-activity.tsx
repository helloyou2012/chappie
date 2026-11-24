import type { AgentActivityItem } from '@chappie/contract';
import {
  RiArrowRightSLine,
  RiCalendarLine,
  RiCheckboxMultipleLine,
  RiErrorWarningLine,
  RiFileTextLine,
  RiLoader4Line,
  RiSearchLine,
  RiSparklingLine,
  RiToolsLine,
  RiTranslate2,
  RiWallet3Line,
} from '@remixicon/react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface AgentActivityProps {
  thinking: string;
  activity: AgentActivityItem[];
  streaming: boolean;
}

function toolIcon(toolId?: string) {
  if (!toolId) return <RiToolsLine className="size-3.5" />;
  if (toolId.startsWith('calendar')) return <RiCalendarLine className="size-3.5" />;
  if (toolId.startsWith('todo')) return <RiCheckboxMultipleLine className="size-3.5" />;
  if (toolId === 'web.search') return <RiSearchLine className="size-3.5" />;
  if (toolId === 'translate') return <RiTranslate2 className="size-3.5" />;
  if (toolId === 'summarize') return <RiFileTextLine className="size-3.5" />;
  if (toolId === 'payment.send') return <RiWallet3Line className="size-3.5" />;
  return <RiToolsLine className="size-3.5" />;
}

function ActivityCursor({ reduceMotion }: { reduceMotion: boolean }) {
  if (reduceMotion) return <span className="ml-0.5 inline-block text-brand">▍</span>;
  return (
    <motion.span
      className="ml-0.5 inline-block text-brand"
      animate={{ opacity: [1, 0.15, 1] }}
      transition={{ duration: 0.9, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
    >
      ▍
    </motion.span>
  );
}

function firstLine(text: string, max = 42): string {
  const line = text.split('\n').find((l) => l.trim()) ?? '';
  const trimmed = line.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * Agent 活动时间线：思考 + 工具调用。仅在主人视角可见（数据由 core 按 viewer 剥离）。
 * 形态对齐「N tool calls」折叠面板：分组折叠、每行独立展开、详情左侧竖线。
 */
export function AgentActivity({ thinking, activity, streaming }: AgentActivityProps) {
  const reduceMotion = Boolean(useReducedMotion());
  const [groupOpen, setGroupOpen] = useState(true);
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const toolCount = activity.filter((a) => a.kind === 'tool').length;

  if (!thinking && activity.length === 0) return null;

  const rowOpen = (key: string, fallback = false) => openRows[key] ?? fallback;
  const toggleRow = (key: string, fallback = false) => {
    setOpenRows((prev) => ({ ...prev, [key]: !(prev[key] ?? fallback) }));
  };
  const transition = { duration: reduceMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] as const };

  const rows = [
    ...(thinking
      ? [
          {
            key: 'thinking',
            title: '思考',
            detail: firstLine(thinking),
            content: thinking,
            status: (streaming ? 'running' : 'done') as 'running' | 'done' | 'failed',
            icon: <RiSparklingLine className="size-3.5 text-brand" />,
            mono: false,
            fallbackOpen: streaming,
            cursor: streaming,
          },
        ]
      : []),
    ...activity.map((item, index) => ({
      key: `tool-${index}`,
      title: item.title,
      detail: item.detail,
      content: item.content,
      status: item.status,
      icon: toolIcon(item.toolId),
      mono: true,
      fallbackOpen: false,
      cursor: item.status === 'running',
    })),
  ];

  // 只有一个条目：不做二级分组，但这一行本身可以收起（默认展开）
  if (rows.length === 1) {
    const row = rows[0]!;
    // thinking: 流式时展开，完成后自动收起；tool call: 默认收起
    const open = rowOpen(row.key, row.fallbackOpen);
    return (
      <div className="w-full text-[12px]">
        <button
          type="button"
          className="group/row flex w-full items-center gap-2 rounded-md py-0.5 text-left hover:bg-surface-hover"
          onClick={() => toggleRow(row.key, row.fallbackOpen)}
          aria-expanded={open}
        >
          <span className="relative flex size-3.5 shrink-0 items-center justify-center">
            <span className="text-ink-tertiary transition-opacity group-hover/row:opacity-0 group-focus-visible/row:opacity-0">
              {row.icon}
            </span>
            <motion.span
              animate={{ rotate: open ? 90 : 0 }}
              transition={transition}
              className="pointer-events-none absolute inset-0 flex items-center justify-center text-ink-quaternary opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
            >
              <RiArrowRightSLine className="size-3.5" />
            </motion.span>
          </span>
          <span className="shrink-0 font-medium text-ink-secondary">{row.title}</span>
          {row.detail ? (
            <span className="max-w-[58%] truncate rounded-md bg-surface-raised px-2 py-0.5 font-mono text-[11px] text-ink-tertiary">
              {row.detail}
            </span>
          ) : null}
          {row.status === 'running' ? (
            <RiLoader4Line className="ml-auto size-3 animate-spin text-brand" />
          ) : row.status === 'failed' ? (
            <RiErrorWarningLine className="ml-auto size-3 text-destructive" />
          ) : null}
        </button>
        <AnimatePresence initial={false}>
          {open ? (
            <motion.div
              initial={reduceMotion ? false : { height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={transition}
              className="overflow-hidden"
            >
              <div className="ml-[13px] border-l border-line py-1 pl-3">
                <div
                  className={cn(
                    'max-h-56 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed text-ink-tertiary',
                    row.mono ? 'font-mono text-[11px]' : 'text-[12px]',
                  )}
                >
                  {row.content}
                  {row.cursor ? <ActivityCursor reduceMotion={reduceMotion} /> : null}
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="w-full text-[12px]">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 py-0.5 text-left font-medium text-ink-tertiary"
        onClick={() => setGroupOpen((v) => !v)}
      >
        <motion.span
          animate={{ rotate: groupOpen ? 90 : 0 }}
          transition={transition}
          className="text-ink-quaternary"
        >
          <RiArrowRightSLine className="size-3.5" />
        </motion.span>
        <span>
          {toolCount > 0 ? `${toolCount} 次工具调用` : '思考过程'}
          {toolCount > 0 && thinking ? ' · 思考' : ''}
        </span>
        {streaming ? (
          <motion.span
            className="text-[10px] font-normal text-ink-quaternary"
            animate={reduceMotion ? undefined : { opacity: [0.45, 1, 0.45] }}
            transition={{ duration: 1.2, repeat: Number.POSITIVE_INFINITY }}
          >
            进行中…
          </motion.span>
        ) : null}
      </button>

      <AnimatePresence initial={false}>
        {groupOpen ? (
          <motion.div
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={transition}
            className="overflow-hidden"
          >
            <div className="mt-0.5 space-y-0.5">
              {rows.map((row) => {
                const open = rowOpen(row.key, row.fallbackOpen);
                return (
                  <div key={row.key}>
                    <button
                      type="button"
                      className="group/row flex w-full items-center gap-2 rounded-md py-0.5 text-left hover:bg-surface-hover"
                      onClick={() => toggleRow(row.key, row.fallbackOpen)}
                      aria-expanded={open}
                    >
                      <span className="relative flex size-3.5 shrink-0 items-center justify-center">
                        <span className="text-ink-tertiary transition-opacity group-hover/row:opacity-0 group-focus-visible/row:opacity-0">
                          {row.icon}
                        </span>
                        <motion.span
                          animate={{ rotate: open ? 90 : 0 }}
                          transition={transition}
                          className="pointer-events-none absolute inset-0 flex items-center justify-center text-ink-quaternary opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
                        >
                          <RiArrowRightSLine className="size-3.5" />
                        </motion.span>
                      </span>
                      <span className="shrink-0 font-medium text-ink-secondary">{row.title}</span>
                      {row.detail ? (
                        <span className="max-w-[58%] truncate rounded-md bg-surface-raised px-2 py-0.5 font-mono text-[11px] text-ink-tertiary">
                          {row.detail}
                        </span>
                      ) : null}
                      {row.status === 'running' ? (
                        <RiLoader4Line className="ml-auto size-3 animate-spin text-brand" />
                      ) : row.status === 'failed' ? (
                        <RiErrorWarningLine className="ml-auto size-3 text-destructive" />
                      ) : null}
                    </button>
                    <AnimatePresence initial={false}>
                      {open ? (
                        <motion.div
                          initial={reduceMotion ? false : { height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={transition}
                          className="overflow-hidden"
                        >
                          <div className="ml-[13px] border-l border-line py-1 pl-3">
                            <div
                              className={cn(
                                'max-h-56 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed text-ink-tertiary',
                                row.mono ? 'font-mono text-[11px]' : 'text-[12px]',
                              )}
                            >
                              {row.content}
                              {row.cursor ? <ActivityCursor reduceMotion={reduceMotion} /> : null}
                            </div>
                          </div>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
