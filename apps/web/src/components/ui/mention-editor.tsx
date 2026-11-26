import Placeholder from '@tiptap/extension-placeholder';
import { type Editor, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  forwardRef,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/utils';
import { MentionNode } from './mention-node';

export interface MentionCandidate {
  /** 写入 mentions 数组的标识 */
  id: string;
  /** 标签与候选行展示的文本 */
  name: string;
  /** 透传给标签节点的 data-kind，用于样式区分（如 human / avatar / all） */
  kind?: string;
  /** 额外过滤词（如「所有人」可用 all 搜索） */
  aliases?: string[];
}

export interface MentionEditorValue {
  /** 纯文本，@ 标签序列化为 `@昵称` */
  text: string;
  /** 文档内全部标签的 id（按首次出现顺序去重） */
  mentions: string[];
}

export interface MentionEditorHandle {
  getValue: () => MentionEditorValue;
  clear: () => void;
  focus: () => void;
  /** 在光标处插入 @ 并唤起候选（供工具栏按钮调用） */
  triggerMention: () => void;
}

export interface MentionEditorProps {
  candidates: MentionCandidate[];
  placeholder?: string;
  /** 应用到 ProseMirror 可编辑元素上的类名（高度 / 内边距 / 字号等） */
  editorClassName?: string;
  /** 候选弹层标题 */
  popupTitle?: ReactNode;
  /** 自定义候选行内容；默认只渲染名称 */
  renderCandidate?: (candidate: MentionCandidate) => ReactNode;
  onChange?: (value: MentionEditorValue) => void;
  /** 文档每次变化（用于广播「正在输入」） */
  onTyping?: () => void;
  /** Enter 且候选弹层未打开时触发（发送） */
  onSubmit?: () => void;
  /** 粘贴文件；返回 true 表示已消费（阻止默认粘贴行为） */
  onPasteFiles?: (files: File[], hasPlainText: boolean) => boolean;
  className?: string;
}

interface MentionPopup {
  /** 待替换的 @query 在文档中的区间 */
  from: number;
  to: number;
  items: MentionCandidate[];
  index: number;
}

const extensions = (placeholder: string) => [
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
  Placeholder.configure({ placeholder }),
  MentionNode,
];

function readValue(editor: Editor): MentionEditorValue {
  const mentions: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'mention') return true;
    const id = node.attrs.id;
    if (typeof id === 'string' && id && !mentions.includes(id)) mentions.push(id);
    return false;
  });
  return { text: editor.getText({ blockSeparator: '\n' }), mentions };
}

function matchesQuery(candidate: MentionCandidate, needle: string): boolean {
  if (!needle) return true;
  if (candidate.name.toLowerCase().includes(needle)) return true;
  return (candidate.aliases ?? []).some((alias) => alias.toLowerCase().includes(needle));
}

/**
 * 带行内 @ 标签的纯文本输入框（TipTap）。
 * 提及候选、标签样式与回传值都在此统一处理，业务侧只需提供候选与回调。
 */
export const MentionEditor = forwardRef<MentionEditorHandle, MentionEditorProps>(
  function MentionEditor(
    {
      candidates,
      placeholder = '',
      editorClassName,
      popupTitle = '提及成员',
      renderCandidate,
      onChange,
      onTyping,
      onSubmit,
      onPasteFiles,
      className,
    },
    ref,
  ) {
    const [mention, setMention] = useState<MentionPopup | null>(null);
    /** ProseMirror 事件处理器只注册一次，通过 ref 拿到最新的 React 闭包 */
    const keyHandlerRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
    const pasteHandlerRef = useRef<(event: ClipboardEvent) => boolean>(() => false);
    const candidatesRef = useRef(candidates);
    candidatesRef.current = candidates;
    const callbacksRef = useRef({ onChange, onTyping, onSubmit, onPasteFiles });
    callbacksRef.current = { onChange, onTyping, onSubmit, onPasteFiles };

    const editor = useEditor({
      extensions: extensions(placeholder),
      content: '',
      editorProps: {
        attributes: {
          class: cn(
            'mention-editor scrollbar-thin w-full overflow-y-auto focus:outline-none',
            editorClassName,
          ),
        },
        handleKeyDown: (_view, event) => keyHandlerRef.current(event),
        handlePaste: (_view, event) => pasteHandlerRef.current(event),
      },
    });

    useEffect(() => {
      if (!editor) return;
      const refreshMention = () => {
        // 输入法组合中不做检测，避免把拼音当作查询词
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
        const items = candidatesRef.current
          .filter((c) => matchesQuery(c, query.toLowerCase()))
          .slice(0, 8);
        if (items.length === 0) {
          setMention(null);
          return;
        }
        setMention((prev) => ({
          from: $from.pos - query.length - 1,
          to: $from.pos,
          items,
          index: prev ? Math.min(prev.index, items.length - 1) : 0,
        }));
      };
      const handleUpdate = () => {
        callbacksRef.current.onChange?.(readValue(editor));
        callbacksRef.current.onTyping?.();
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
    }, [editor]);

    /** 用选中的候选替换正在输入的 @query */
    const pickMention = (candidate: MentionCandidate) => {
      if (!editor || !mention) return;
      editor
        .chain()
        .focus()
        .deleteRange({ from: mention.from, to: mention.to })
        .insertContent([
          {
            type: 'mention',
            attrs: {
              id: candidate.id,
              label: candidate.name,
              kind: candidate.kind ?? 'human',
            },
          },
          { type: 'text', text: ' ' },
        ])
        .run();
      setMention(null);
    };

    const handleKeyDown = (e: KeyboardEvent): boolean => {
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
      if (e.key === 'Enter' && !e.shiftKey && callbacksRef.current.onSubmit) {
        e.preventDefault();
        callbacksRef.current.onSubmit();
        return true;
      }
      return false;
    };

    const handlePaste = (e: ClipboardEvent): boolean => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return false;
      const hasPlainText = Boolean(e.clipboardData?.getData('text/plain'));
      const handled = callbacksRef.current.onPasteFiles?.(files, hasPlainText) ?? false;
      if (handled) e.preventDefault();
      return handled;
    };

    // 每次渲染刷新处理器，保证 ProseMirror 调用到最新的状态与闭包
    useEffect(() => {
      keyHandlerRef.current = handleKeyDown;
      pasteHandlerRef.current = handlePaste;
    });

    useImperativeHandle(
      ref,
      () => ({
        getValue: () => (editor ? readValue(editor) : { text: '', mentions: [] }),
        clear: () => {
          editor?.commands.clearContent(true);
          setMention(null);
        },
        focus: () => editor?.commands.focus(),
        triggerMention: () => editor?.chain().focus().insertContent('@').run(),
      }),
      [editor],
    );

    return (
      <div className={cn('relative', className)}>
        {/* 提及候选（浮层） */}
        {mention ? (
          <div className="absolute bottom-full left-0 right-0 z-20 mb-2 w-64 overflow-hidden rounded-md border border-line bg-popover p-1 shadow-pop">
            <div className="px-2 py-1 text-[11px] font-medium text-ink-tertiary">{popupTitle}</div>
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
                {renderCandidate ? (
                  renderCandidate(c)
                ) : (
                  <span className="flex-1 truncate">{c.name}</span>
                )}
              </button>
            ))}
          </div>
        ) : null}

        <EditorContent editor={editor} />
      </div>
    );
  },
);
