import { ALL_MENTION_ID, type Content } from '@chappie/contract';
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
  RiTeamLine,
} from '@remixicon/react';
import Placeholder from '@tiptap/extension-placeholder';
import { type Editor, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { UserAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { getRealtimeClient } from '@/lib/realtime';
import { cn } from '@/lib/utils';
import { MentionNode } from './mention-node';

function newClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `cm_${crypto.randomUUID()}`;
  }
  return `cm_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/** 纯文本输入：保留换行与 @ 提及标签，不支持富文本格式 */
const composerExtensions = [
  StarterKit.configure({
    blockquote: false,
    bold: false,
    bulletList: false,
    code: false,
    codeBlock: false,
    dropcursor: false,
    gapcursor: false,
    heading: false,
    horizontalRule: false,
    italic: false,
    link: false,
    listItem: false,
    listKeymap: false,
    orderedList: false,
    strike: false,
    trailingNode: false,
    underline: false,
  }),
  Placeholder.configure({ placeholder: '发消息，或 @ 提及成员…' }),
  MentionNode,
];

/** 「所有人」不是真实 principal：发送时展开为会话内全部真人成员 + 广播标记 */
const ALL_OPTION: MentionOption = { id: ALL_MENTION_ID, name: '所有人', kind: 'all' };

interface MentionOption {
  id: string;
  name: string;
  kind: 'human' | 'avatar' | 'all';
}

interface MentionPopup {
  query: string;
  /** 待替换的 @query 在文档中的区间 */
  from: number;
  to: number;
  items: MentionOption[];
  index: number;
}

function collectMentionIds(editor: Editor): string[] {
  const ids: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'mention') return true;
    const id = node.attrs.id;
    if (typeof id === 'string' && id && id !== ALL_MENTION_ID && !ids.includes(id)) ids.push(id);
    return false;
  });
  return ids;
}

function hasAllMention(editor: Editor): boolean {
  let found = false;
  editor.state.doc.descendants((node) => {
    if (found) return false;
    if (node.type.name === 'mention' && node.attrs.id === ALL_MENTION_ID) found = true;
    return !found;
  });
  return found;
}

interface ChatInputProps {
  convId: string;
  members?: MemberView[];
  /** 群聊：@ 候选里额外提供「所有人」 */
  isGroup?: boolean;
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
  { convId, members, isGroup = false, avatarTyping = false, replyTo, onCancelReply },
  ref,
) {
  const myId = useAuthStore((s) => s.user?.id ?? '');
  const [docText, setDocText] = useState('');
  const [mention, setMention] = useState<MentionPopup | null>(null);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<{ file: File; preview: string | null }[]>([]);
  /** 同步发送锁：state 更新前拦住连点/连续回车 */
  const sendingRef = useRef(false);
  const lastSentAtRef = useRef(0);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTypingRef = useRef(0);
  /** 提及候选：members 变化频繁（每次消息刷新），用 ref 避免重建编辑器/重订阅 */
  const candidatesRef = useRef<MentionOption[]>([]);
  candidatesRef.current = (members ?? [])
    .filter((m) => m.principalId !== myId)
    .map((m) => ({
      id: m.principalId,
      name: m.name,
      kind: m.principalType === 'avatar' ? 'avatar' : 'human',
    }));
  /** ProseMirror 事件处理器只注册一次，通过 ref 拿到最新的 React 闭包 */
  const keyHandlerRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const pasteHandlerRef = useRef<(event: ClipboardEvent) => boolean>(() => false);

  const editor = useEditor({
    extensions: composerExtensions,
    content: '',
    editorProps: {
      attributes: {
        class:
          'chat-composer-editor scrollbar-thin max-h-40 min-h-[48px] w-full overflow-y-auto px-4 pb-1 pt-3.5 text-[14px] leading-[1.5] text-ink focus:outline-none',
      },
      handleKeyDown: (_view, event) => keyHandlerRef.current(event),
      handlePaste: (_view, event) => pasteHandlerRef.current(event),
    },
  });

  // 文档变化 → 同步发送按钮状态 / 输入中提示 / @ 候选弹层
  useEffect(() => {
    if (!editor) return;
    const refreshMention = () => {
      // 中文输入法组合中不做检测，避免把拼音当作查询词
      if (editor.view.composing) return;
      const { $from } = editor.state.selection;
      if (!$from.parent.isTextblock) {
        setMention(null);
        return;
      }
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
      const match = /@([^\s@]{0,20})$/.exec(before);
      if (!match) {
        setMention(null);
        return;
      }
      const query = match[1] ?? '';
      const needle = query.toLowerCase();
      // 「所有人」仅在群聊出现；支持输入「所」或 all 过滤
      const showAll =
        isGroup && (query === '' || '所有人'.includes(query) || 'all'.startsWith(needle));
      const items: MentionOption[] = [
        ...(showAll ? [ALL_OPTION] : []),
        ...candidatesRef.current
          .filter((c) => c.name.toLowerCase().includes(needle))
          .sort((a, b) => Number(b.kind === 'avatar') - Number(a.kind === 'avatar'))
          .slice(0, 8),
      ];
      if (items.length === 0) {
        setMention(null);
        return;
      }
      setMention((prev) => ({
        query,
        from: $from.pos - query.length - 1,
        to: $from.pos,
        items,
        index: prev && prev.query === query ? Math.min(prev.index, items.length - 1) : 0,
      }));
    };
    const handleUpdate = () => {
      setDocText(editor.getText({ blockSeparator: '\n' }));
      const now = Date.now();
      if (now - lastTypingRef.current > 1500) {
        lastTypingRef.current = now;
        getRealtimeClient()?.typing(convId);
      }
      refreshMention();
    };
    const handleSelection = () => refreshMention();
    const handleBlur = () => setMention(null);
    editor.on('update', handleUpdate);
    editor.on('selectionUpdate', handleSelection);
    editor.on('blur', handleBlur);
    return () => {
      editor.off('update', handleUpdate);
      editor.off('selectionUpdate', handleSelection);
      editor.off('blur', handleBlur);
    };
  }, [editor, convId, isGroup]);

  /** 用选中的成员标签替换正在输入的 @query */
  const pickMention = (option: MentionOption) => {
    if (!editor || !mention) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: mention.from, to: mention.to })
      .insertContent([
        {
          type: 'mention',
          attrs: { id: option.id, label: option.name, kind: option.kind },
        },
        { type: 'text', text: ' ' },
      ])
      .run();
    setMention(null);
  };

  /** 工具行 @ 按钮：在光标处插入 @ 并唤起候选 */
  const insertMentionTrigger = () => {
    editor?.chain().focus().insertContent('@').run();
  };

  const handleComposerKeyDown = (e: KeyboardEvent): boolean => {
    // 输入法组合期间（Enter 确认候选词）不拦截按键
    if (e.isComposing || e.keyCode === 229) return false;
    if (mention) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMention((m) => (m ? { ...m, index: (m.index + 1) % m.items.length } : m));
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMention((m) =>
          m ? { ...m, index: (m.index - 1 + m.items.length) % m.items.length } : m,
        );
        return true;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const target = mention.items[mention.index];
        if (target) pickMention(target);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return true;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
      return true;
    }
    return false;
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
    const value = (editor?.getText({ blockSeparator: '\n' }) ?? '').trim();
    if (!value && attachments.length === 0) return;
    const ws = getRealtimeClient();
    if (!ws?.isOpen) {
      toast.error('连接未就绪', '正在重新连接，请稍候再试');
      return;
    }
    // 提及 id 直接取自文档里的标签节点：删掉标签即不会带上对应 id
    const activeMentions = editor ? collectMentionIds(editor) : [];
    // @所有人：带上广播标记 + 会话内全部真人（不含发送者）。
    // 不展开成分身 id —— AI 路由会把广播视为「非排他提及」，让各成员分身照常代答。
    if (editor && hasAllMention(editor)) {
      if (!activeMentions.includes(ALL_MENTION_ID)) activeMentions.push(ALL_MENTION_ID);
      for (const m of members ?? []) {
        if (m.principalType !== 'human' || m.principalId === myId) continue;
        if (!activeMentions.includes(m.principalId)) activeMentions.push(m.principalId);
      }
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
        mentions: activeMentions,
        replyTo: replyToId,
        createdAt,
        status: 'sending',
      });
    }
    editor?.commands.clearContent(true);
    setDocText('');
    setMention(null);
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
          { clientMsgId: textId, mentions: activeMentions, replyTo: replyToId },
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
  const handlePaste = (e: ClipboardEvent): boolean => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length === 0) return false;
    addFiles(files);
    if (e.clipboardData?.getData('text/plain')) return false;
    e.preventDefault();
    return true;
  };

  // 每次渲染刷新处理器，保证 ProseMirror 调用到最新的状态与闭包
  useEffect(() => {
    keyHandlerRef.current = handleComposerKeyDown;
    pasteHandlerRef.current = handlePaste;
  });

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
                key={`${att.file.name}-${att.file.size}-${att.file.lastModified}`}
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
        {mention ? (
          <div className="absolute bottom-full left-0 right-0 z-20 mb-2 w-64 overflow-hidden rounded-md border border-line bg-popover p-1 shadow-pop">
            <div className="px-2 py-1 text-[11px] font-medium text-ink-tertiary">
              <RiAtLine className="mr-1 inline size-3" />
              提及成员
            </div>
            {mention.items.map((c, i) => (
              <button
                type="button"
                key={c.id}
                // 保持编辑器聚焦与选区，避免点击候选前 blur 关闭弹层
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickMention(c)}
                className={cn(
                  'flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink',
                  i === mention.index && 'bg-surface-hover text-ink',
                )}
              >
                {c.kind === 'all' ? (
                  <span className="flex size-5 items-center justify-center rounded-full bg-brand-soft text-brand">
                    <RiTeamLine className="size-3.5" />
                  </span>
                ) : (
                  <UserAvatar
                    name={c.name}
                    variant={c.kind}
                    className="size-5"
                    showAiBadge={false}
                  />
                )}
                <span className="flex-1 truncate">{c.name}</span>
                {c.kind === 'avatar' ? (
                  <Badge variant="ai" className="shrink-0">
                    <SparklesIcon className="size-2.5" /> AI 分身
                  </Badge>
                ) : (
                  <Badge variant="muted" className="shrink-0">
                    {c.kind === 'all' ? '全员' : '真人'}
                  </Badge>
                )}
              </button>
            ))}
          </div>
        ) : null}

        {/* 文本域（TipTap：@ 成员以内联标签展示） */}
        <EditorContent editor={editor} />

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
              disabled={(!docText.trim() && attachments.length === 0) || uploading}
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
