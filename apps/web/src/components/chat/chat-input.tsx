import type { Content } from '@chappie/contract';
import { adminApi, api, dayjs, type MemberView, useAuthStore, useChatStore } from '@chappie/shared';
import { SparklesIcon } from '@heroicons/react/24/outline';
import {
  RiAtLine,
  RiAttachment2,
  RiCloseLine,
  RiFileTextLine,
  RiImageLine,
  RiLoader4Line,
  RiSendPlaneFill,
  RiStopCircleLine,
} from '@remixicon/react';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { UserAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { getRealtimeClient } from '@/lib/realtime';

function newClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `cm_${crypto.randomUUID()}`;
  }
  return `cm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

interface ChatInputProps {
  convId: string;
  members?: MemberView[];
  /** 分身正在处理：把发送按钮切换为停止/接管 */
  avatarTyping?: boolean;
  replyTo?: { msgId: string; preview: string } | null;
  onCancelReply?: () => void;
}

export interface ChatInputHandle {
  /** 供页面级拖拽/粘贴入口把文件放入暂存区 */
  addFiles: (files: File[]) => void;
}

/**
 * 一体化输入面板：
 * 单个圆角容器内包含文本域 + 底部工具行（左：@ 提及与快捷键提示；右：圆形发送按钮），
 * 内部无分隔线，通过底色与间距组织层级。
 */
export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  { convId, members, avatarTyping = false, replyTo, onCancelReply },
  ref,
) {
  const myId = useAuthStore((s) => s.user?.id ?? '');
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<{ file: File; preview: string | null }[]>([]);
  /** 同步发送锁：state 更新前拦住连点/连续回车 */
  const sendingRef = useRef(false);
  const lastSentAtRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const takeover = () => {
    void api
      .takeover(convId)
      .then(() => toast.success('已接管', '分身已暂停，冷却 15 分钟'))
      .catch((e) => toast.error('接管失败', e instanceof Error ? e.message : String(e)));
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => {
      const target = prev[index];
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const send = async () => {
    // 同步锁 + 短冷却：拦截连点、连续回车等重复提交
    if (sendingRef.current || Date.now() - lastSentAtRef.current < 600) return;
    const value = text.trim();
    if (!value && attachments.length === 0) return;
    const ws = getRealtimeClient();
    if (!ws?.isOpen) {
      toast.error('连接未就绪', '正在重新连接，请稍候再试');
      return;
    }
    sendingRef.current = true;
    lastSentAtRef.current = Date.now();
    setUploading(true);

    const store = useChatStore.getState();
    const batch = [...attachments];
    const batchIds = batch.map(() => newClientId());
    const textId = value ? newClientId() : null;
    const createdAt = dayjs().toISOString();
    const replyToId = replyTo?.msgId ?? null;

    // 1) 立即上屏：图片用本地预览，文件先显示文件卡，文本同时显示
    batch.forEach((att, i) => {
      const content: Content = att.file.type.startsWith('image/')
        ? { type: 'image', schemaVersion: 1, url: att.preview ?? '', name: att.file.name }
        : { type: 'file', schemaVersion: 1, url: '', name: att.file.name, size: att.file.size };
      store.addPending({
        clientMsgId: batchIds[i]!,
        convId,
        content,
        mentions: [],
        replyTo: replyToId,
        createdAt,
        status: 'uploading',
      });
    });
    if (value && textId) {
      store.addPending({
        clientMsgId: textId,
        convId,
        content: { type: 'text', schemaVersion: 1, text: value },
        mentions,
        replyTo: replyToId,
        createdAt,
        status: 'sending',
      });
    }
    setText('');
    setMentions([]);
    setMentionQuery(null);
    setAttachments([]);
    onCancelReply?.();

    const uploaded: { clientMsgId: string; content: Content }[] = [];
    try {
      // 2) 异步上传；上传完成只更新 pending，不立即发 WS
      for (let i = 0; i < batch.length; i++) {
        const att = batch[i]!;
        const clientMsgId = batchIds[i]!;
        try {
          const { file: info, url } = await adminApi.uploadFile(att.file, att.file.name);
          const content: Content = info.mime.startsWith('image/')
            ? { type: 'image', schemaVersion: 1, url, name: info.name }
            : { type: 'file', schemaVersion: 1, url, name: info.name, size: info.size };
          store.updatePending(convId, clientMsgId, { content, status: 'sending' });
          uploaded.push({ clientMsgId, content });
          if (att.preview) URL.revokeObjectURL(att.preview);
        } catch (e) {
          store.removePending(convId, clientMsgId);
          toast.error(
            '上传失败',
            `${att.file.name}: ${e instanceof Error ? e.message : String(e)}`,
          );
          // 放回暂存，保留预览供重试
          setAttachments((prev) => [...prev, att]);
        }
      }

      // 3) 全部上传完成后按顺序快速提交，附件+文本落在同一个 AI 合并窗口内
      for (const item of uploaded) {
        ws.sendMessage(convId, item.content, {
          clientMsgId: item.clientMsgId,
          mentions: [],
          replyTo: replyToId,
        });
      }
      if (value && textId) {
        ws.sendMessage(
          convId,
          { type: 'text', schemaVersion: 1, text: value },
          { clientMsgId: textId, mentions, replyTo: replyToId },
        );
      }
    } catch (e) {
      toast.error('发送失败', e instanceof Error ? e.message : String(e));
    } finally {
      sendingRef.current = false;
      setUploading(false);
    }
  };

  /** 统一入口：选择器、粘贴、拖拽都先暂存，发送时再上传 */
  const addFiles = (incoming: File[]) => {
    const files = incoming.map((file, index) => {
      if (file.name) return file;
      const ext = file.type.split('/')[1] || 'bin';
      return new File([file], `attachment-${Date.now()}-${index}.${ext}`, { type: file.type });
    });
    const next = files
      .filter((file) => {
        if (file.size > 20 * 1024 * 1024) {
          toast.error('文件过大', `${file.name} 超过 20MB`);
          return false;
        }
        return true;
      })
      .map((file) => ({
        file,
        preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
      }));
    if (next.length > 0) setAttachments((prev) => [...prev, ...next]);
  };

  useImperativeHandle(ref, () => ({ addFiles }));

  const pickFiles = (input: HTMLInputElement | null) => {
    const files = input?.files ? Array.from(input.files) : [];
    if (input) input.value = '';
    if (files.length > 0) addFiles(files);
  };

  /** 粘贴文件/截图：有文本时保留默认文本粘贴，文件同时进入暂存区 */
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length === 0) return;
    addFiles(files);
    if (!e.clipboardData.getData('text/plain')) e.preventDefault();
  };

  return (
    <div className="relative z-1 px-3 pb-3">
      {/* 消息流渐隐层：贴在输入面板上方，四段渐变融入背景 */}
      <div
        aria-hidden
        className="composer-fade pointer-events-none absolute inset-x-0 bottom-full h-8"
      />
      <div className="relative rounded-2xl border border-line/70 bg-panel shadow-pop transition-colors focus-within:border-[color-mix(in_srgb,var(--brand)_45%,transparent)]">
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

        {/* 待发送附件：先在输入框上方展示，点发送才上传 */}
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2 px-3 pt-2">
            {attachments.map((att, i) => (
              <div
                key={`${att.file.name}-${i}`}
                className="flex items-center gap-2 rounded-lg border border-line bg-surface-veil py-1 pl-1 pr-1.5"
              >
                {att.preview ? (
                  <img
                    src={att.preview}
                    alt={att.file.name}
                    className="size-9 rounded object-cover"
                  />
                ) : (
                  <span className="flex size-9 items-center justify-center rounded bg-surface-raised">
                    <RiFileTextLine className="size-4 text-ink-tertiary" />
                  </span>
                )}
                <span className="max-w-32 truncate text-[11px] text-ink-secondary">
                  {att.file.name}
                </span>
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  className="flex size-5 items-center justify-center rounded text-ink-quaternary transition-colors hover:bg-surface-hover hover:text-ink"
                  aria-label="移除附件"
                >
                  <RiCloseLine className="size-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {/* 提及候选（面板上方浮层） */}
        {mentionQuery !== null && filtered.length > 0 ? (
          <div className="absolute bottom-full left-0 right-0 z-20 mb-2 w-64 overflow-hidden rounded-md border border-line bg-popover p-1 shadow-pop">
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
                  showAiBadge={false}
                />
                <span className="flex-1 truncate">{c.name}</span>
                {c.principalType === 'avatar' ? (
                  <Badge variant="ai" className="shrink-0">
                    <SparklesIcon className="size-2.5" /> AI 分身
                  </Badge>
                ) : (
                  <Badge variant="muted" className="shrink-0">
                    真人
                  </Badge>
                )}
              </button>
            ))}
          </div>
        ) : null}

        {/* 文本域 */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (mentionQuery !== null && filtered.length > 0) {
                pickMention(filtered[0]);
                return;
              }
              void send();
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
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={() => pickFiles(imageInputRef.current)}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,.json,.csv,.zip,.docx,.xlsx"
              multiple
              className="hidden"
              onChange={() => pickFiles(fileInputRef.current)}
            />
            <button
              type="button"
              onClick={insertMentionTrigger}
              title="提及成员"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink"
            >
              <RiAtLine className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={uploading}
              title="上传图片"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-50"
            >
              <RiImageLine className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="上传文件"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-50"
            >
              <RiAttachment2 className="size-4" />
            </button>
            {uploading ? (
              <span className="flex items-center gap-1 truncate text-[11px] text-ink-quaternary">
                <RiLoader4Line className="size-3 animate-spin" />
                上传中…
              </span>
            ) : (
              <span className="truncate text-[11px] text-ink-quaternary">
                Enter 发送 · Shift+Enter 换行
              </span>
            )}
          </div>
          {avatarTyping ? (
            <Button
              size="icon-sm"
              variant="destructive"
              className="shrink-0 rounded-full p-0"
              onClick={takeover}
              aria-label="停止分身并接管"
              title="停止分身并接管"
            >
              <RiStopCircleLine className="size-4" />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              variant="secondary"
              className="shrink-0 rounded-full p-0"
              onClick={() => void send()}
              disabled={(!text.trim() && attachments.length === 0) || uploading}
              aria-label="发送"
            >
              <RiSendPlaneFill className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
});
