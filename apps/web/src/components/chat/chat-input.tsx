import { dayjs, type MemberView, useAuthStore, useChatStore } from '@chappie/shared';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { RiAtLine, RiCloseLine, RiSendPlaneFill } from '@remixicon/react';
import { useRef, useState } from 'react';
import { UserAvatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { getRealtimeClient } from '@/lib/realtime';

interface ChatInputProps {
  convId: string;
  members?: MemberView[];
  replyTo?: { msgId: string; preview: string } | null;
  onCancelReply?: () => void;
}

/**
 * 一体化输入面板：
 * 单个圆角容器内包含文本域 + 底部工具行（左：@ 提及与快捷键提示；右：圆形发送按钮），
 * 内部无分隔线，通过底色与间距组织层级。
 */
export function ChatInput({ convId, members, replyTo, onCancelReply }: ChatInputProps) {
  const myId = useAuthStore((s) => s.user?.id ?? '');
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingRef = useRef(0);

  const candidates = (members ?? []).filter((m) => m.principalId !== myId);
  const filtered =
    mentionQuery === null
      ? []
      : candidates.filter(
          (c) =>
            c.name.toLowerCase().includes(mentionQuery.toLowerCase()) ||
            (mentionQuery === '' && c.principalType === 'avatar'),
        );

  const emitTyping = () => {
    const now = Date.now();
    if (now - lastTypingRef.current > 1500) {
      lastTypingRef.current = now;
      getRealtimeClient()?.typing(convId);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setText(value);
    const cursor = e.target.selectionStart ?? value.length;
    const before = value.slice(0, cursor);
    const match = /@([^\s@]{0,20})$/.exec(before);
    setMentionQuery(match ? match[1] : null);
    emitTyping();
  };

  const pickMention = (c: MemberView) => {
    const el = textareaRef.current;
    const cursor = el?.selectionStart ?? text.length;
    const before = text.slice(0, cursor).replace(/@([^\s@]{0,20})$/, `@${c.name} `);
    const after = text.slice(cursor);
    setText(before + after);
    setMentions((prev) => (prev.includes(c.principalId) ? prev : [...prev, c.principalId]));
    setMentionQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = before.length;
      el?.setSelectionRange(pos, pos);
    });
  };

  /** 工具行 @ 按钮：在光标处插入 @ 并唤起候选 */
  const insertMentionTrigger = () => {
    const el = textareaRef.current;
    const cursor = el?.selectionStart ?? text.length;
    const next = `${text.slice(0, cursor)}@${text.slice(cursor)}`;
    setText(next);
    setMentionQuery('');
    requestAnimationFrame(() => {
      el?.focus();
      const pos = cursor + 1;
      el?.setSelectionRange(pos, pos);
    });
  };

  const send = () => {
    const value = text.trim();
    if (!value) return;
    const ws = getRealtimeClient();
    if (!ws?.isOpen) {
      toast.error('连接未就绪', '正在重新连接，请稍候再试');
      return;
    }
    const content = { type: 'text' as const, schemaVersion: 1, text: value };
    const clientMsgId = ws.sendMessage(convId, content, {
      mentions,
      replyTo: replyTo?.msgId ?? null,
    });
    // 乐观展示
    useChatStore.getState().addPending({
      clientMsgId,
      convId,
      content,
      mentions,
      replyTo: replyTo?.msgId ?? null,
      createdAt: dayjs().toISOString(),
    });
    setText('');
    setMentions([]);
    setMentionQuery(null);
    onCancelReply?.();
  };

  return (
    <div className="relative z-1 px-3 pb-3">
      {/* 消息流渐隐层：贴在输入面板上方，四段渐变融入背景 */}
      <div
        aria-hidden
        className="composer-fade pointer-events-none absolute inset-x-0 bottom-full h-8"
      />
      <div className="relative rounded-2xl border border-line/70 bg-panel/95 shadow-pop transition-colors focus-within:border-[color-mix(in_srgb,var(--brand)_45%,transparent)]">
        {/* 回复条（面板内顶部） */}
        {replyTo ? (
          <div className="mx-2 mt-2 flex items-center gap-2 rounded-md border-l-2 border-brand bg-surface-veil px-2.5 py-1.5 text-[12px]">
            <span className="flex-1 truncate text-ink-tertiary">回复：{replyTo.preview}</span>
            <button
              type="button"
              onClick={onCancelReply}
              className="text-ink-quaternary transition-colors hover:text-ink"
            >
              <RiCloseLine className="size-3.5" />
            </button>
          </div>
        ) : null}

        {/* 提及候选（面板上方浮层） */}
        {mentionQuery !== null && filtered.length > 0 ? (
          <div className="glass absolute bottom-full left-0 right-0 z-20 mb-2 w-64 overflow-hidden rounded-md border border-line p-1 shadow-pop">
            <div className="px-2 py-1 text-[11px] font-medium text-ink-tertiary">
              <RiAtLine className="mr-1 inline size-3" />
              提及成员
            </div>
            {filtered.slice(0, 8).map((c) => (
              <button
                type="button"
                key={c.principalId}
                onClick={() => pickMention(c)}
                className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
              >
                <UserAvatar
                  name={c.name}
                  variant={c.principalType === 'avatar' ? 'avatar' : 'human'}
                  className="size-5"
                />
                <span className="flex-1 truncate">{c.name}</span>
                {c.principalType === 'avatar' ? (
                  <span className="flex items-center gap-0.5 text-[11px] text-agent">
                    <SparklesIcon className="size-2.5" /> 分身
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

        {/* 文本域 */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (mentionQuery !== null && filtered.length > 0) {
                pickMention(filtered[0]);
                return;
              }
              send();
            }
            if (e.key === 'Escape') setMentionQuery(null);
          }}
          placeholder="发消息，或 @ 提及成员…"
          rows={Math.min(5, Math.max(1, text.split('\n').length))}
          className="block max-h-40 min-h-[48px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[14px] leading-[1.5] text-ink placeholder:text-ink-quaternary focus-visible:outline-none"
        />

        {/* 已选提及 */}
        {mentions.length > 0 ? (
          <div className="flex flex-wrap gap-1 px-3 pb-1.5">
            {mentions.map((id) => {
              const m = members?.find((x) => x.principalId === id);
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full bg-surface-raised px-2 py-0.5 text-[11px] text-ink-secondary"
                >
                  @{m?.name ?? id}
                  <button
                    type="button"
                    onClick={() => setMentions((prev) => prev.filter((x) => x !== id))}
                    className="text-ink-quaternary transition-colors hover:text-ink"
                  >
                    <RiCloseLine className="size-2.5" />
                  </button>
                </span>
              );
            })}
          </div>
        ) : null}

        {/* 工具行：左提示 / 右发送 */}
        <div className="flex items-center justify-between gap-2 px-2.5 pb-2">
          <div className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              onClick={insertMentionTrigger}
              title="提及成员"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink"
            >
              <RiAtLine className="size-4" />
            </button>
            <span className="truncate text-[11px] text-ink-quaternary">
              Enter 发送 · Shift+Enter 换行
            </span>
          </div>
          <Button
            size="icon-sm"
            variant="secondary"
            className="shrink-0 rounded-full p-0"
            onClick={send}
            disabled={!text.trim()}
            aria-label="发送"
          >
            <RiSendPlaneFill className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
