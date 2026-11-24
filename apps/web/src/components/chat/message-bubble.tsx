import { contentText } from '@chappie/contract';
import {
  api,
  formatTime,
  type MemberView,
  type Message,
  resolveAttachmentUrl,
  stripToolCallMarkup,
  useAuthStore,
} from '@chappie/shared';
import { ChevronDownIcon, ChevronUpIcon, SparklesIcon } from '@heroicons/react/24/outline';
import {
  RiArrowGoBackLine,
  RiDownloadLine,
  RiFileTextLine,
  RiFlagLine,
  RiMagicLine,
  RiMoreFill,
  RiReplyLine,
  RiThumbUpLine,
} from '@remixicon/react';
import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import remarkBreaks from 'remark-breaks';
import { Streamdown } from 'streamdown';
import { UserAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { getRealtimeClient } from '@/lib/realtime';
import { cn } from '@/lib/utils';
import { AgentActivity } from './agent-activity';
import { CardView } from './cards';

interface MessageBubbleProps {
  message: Message;
  members?: MemberView[];
  showSender?: boolean;
  onReply?: (msgId: string, preview: string) => void;
}

export function MessageBubble({
  message,
  members,
  showSender = true,
  onReply,
}: MessageBubbleProps) {
  const me = useAuthStore((s) => s.user);
  const myId = me?.id ?? '';
  const mine = message.senderId === myId;
  const isAvatar = message.senderType === 'avatar';
  const sender = members?.find((m) => m.principalId === message.senderId);
  // 展示名与头像取色名分离：自己显示「我」，但头像必须用真实名称，
  // 否则同一个人在消息流、成员栏、账户菜单会得到不同颜色。
  const senderName = mine ? '我' : (sender?.name ?? '成员');
  const avatarName = mine ? (sender?.name ?? me?.name ?? '我') : (sender?.name ?? '成员');
  const canRecall = mine || message.onBehalfOf === myId;

  const [showExplain, setShowExplain] = useState(false);
  const [correctOpen, setCorrectOpen] = useState(false);
  const [correctText, setCorrectText] = useState('');
  const reduceMotion = Boolean(useReducedMotion());
  const streaming = Boolean(message.aiMeta?.streaming) && !message.recalled;

  if (message.content.type === 'card') {
    return (
      <div
        className={cn('flex px-4 py-1.5 animate-bubble-in', mine ? 'justify-end' : 'justify-start')}
      >
        <CardView msgId={message.msgId} card={message.content.card} />
      </div>
    );
  }

  const rawText = message.recalled
    ? '消息已撤回'
    : message.content.type === 'text'
      ? message.content.text
      : contentText(message.content);
  // 历史消息可能已把文本形式的 <tool_call> 落库：渲染时兜底剥离
  const text = isAvatar ? stripToolCallMarkup(rawText) : rawText;

  const feedback = (type: 'like' | 'report') => {
    void api
      .feedback(message.msgId, { type })
      .then(() => toast.success(type === 'like' ? '已点赞，反馈已记录' : '已举报，感谢反馈'))
      .catch((e) => toast.error('反馈失败', e instanceof Error ? e.message : String(e)));
  };

  return (
    <div
      className={cn(
        'group flex gap-2 px-4 py-1.5 animate-bubble-in',
        mine ? 'flex-row-reverse' : 'flex-row',
      )}
    >
      {showSender ? (
        <UserAvatar
          name={avatarName}
          variant={isAvatar ? 'avatar' : 'human'}
          className="mt-0.5 size-8"
        />
      ) : (
        <div className="w-8 shrink-0" />
      )}

      <div
        className={cn(
          'flex min-w-0 flex-col gap-1',
          mine ? 'max-w-[72%] items-end' : 'flex-1 items-stretch',
        )}
      >
        {showSender ? (
          <div
            className={cn(
              'flex items-center gap-1.5 text-[11px] text-ink-quaternary',
              mine && 'px-1',
            )}
          >
            <span>{senderName}</span>
            {isAvatar ? (
              <button
                type="button"
                onClick={() => setShowExplain((v) => !v)}
                className="inline-flex items-center gap-0.5 rounded-full bg-ai px-1.5 py-px font-medium text-ai-foreground transition-colors hover:bg-ai/80"
                title="查看分身决策解释"
              >
                <SparklesIcon className="size-2.5" />
                AI 代发
                {message.aiMeta?.explanation ? (
                  showExplain ? (
                    <ChevronUpIcon className="size-2.5" />
                  ) : (
                    <ChevronDownIcon className="size-2.5" />
                  )
                ) : null}
              </button>
            ) : null}
            {message.onBehalfOf === myId && isAvatar ? (
              <Badge variant="muted" className="px-1 py-0 text-[9px]">
                代表你
              </Badge>
            ) : null}
            <span>{formatTime(message.createdAt)}</span>
          </div>
        ) : null}

        <AgentActivity
          thinking={message.recalled ? '' : (message.aiMeta?.thinking ?? '')}
          activity={message.aiMeta?.activity ?? []}
          streaming={streaming}
        />

        {!message.recalled && message.content.type === 'image' ? (
          <a
            href={resolveAttachmentUrl(message.content.url)}
            target="_blank"
            rel="noreferrer"
            className={cn(
              'inline-block max-w-md overflow-hidden rounded-xl',
              mine && 'bg-bubble-user',
              !mine && !isAvatar && 'bg-bubble-other',
            )}
          >
            <img
              src={resolveAttachmentUrl(message.content.url)}
              alt={message.content.name ?? '图片'}
              loading="lazy"
              className="max-h-80 max-w-full rounded-xl object-contain"
            />
          </a>
        ) : !message.recalled && message.content.type === 'file' ? (
          <a
            href={resolveAttachmentUrl(message.content.url)}
            target="_blank"
            rel="noreferrer"
            className={cn(
              'flex max-w-md items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors',
              mine
                ? 'bg-bubble-user text-bubble-user-ink'
                : 'bg-surface-raised text-ink hover:bg-surface-hover',
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-veil">
              <RiFileTextLine className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{message.content.name}</span>
              {typeof message.content.size === 'number' ? (
                <span className="text-[11px] opacity-60">{formatBytes(message.content.size)}</span>
              ) : null}
            </span>
            <RiDownloadLine className="size-4 shrink-0 opacity-60" />
          </a>
        ) : text ? (
          isAvatar && !message.recalled ? (
            // AI 消息：扁平、去气泡、占满宽度，与思考/工具行同级
            <div
              className="w-full min-w-0 max-w-full break-words text-[14px] leading-[1.65] tracking-[-0.15px] text-ink"
              style={{ contain: 'inline-size' }}
            >
              <Streamdown
                animated={streaming}
                isAnimating={streaming}
                parseIncompleteMarkdown
                remarkPlugins={[remarkBreaks]}
                plugins={{ code, mermaid, math, cjk }}
                shikiTheme={['github-light', 'github-dark']}
                mermaid={{ config: { theme: 'neutral' } }}
                className="min-w-0 max-w-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_[data-streamdown=code-block]]:min-w-0 [&_[data-streamdown=code-block]]:max-w-full [&_[data-streamdown=code-block-body]]:max-w-full [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_img]:max-w-full [&_img]:rounded-lg"
              >
                {text}
              </Streamdown>
              {streaming ? <StreamCursor reduceMotion={reduceMotion} /> : null}
            </div>
          ) : (
            <div
              className={cn(
                'rounded-2xl px-3.5 py-2 text-[14px] leading-[1.45] tracking-[-0.15px] break-words whitespace-pre-wrap',
                message.recalled
                  ? 'border border-dashed border-line bg-transparent text-ink-tertiary italic'
                  : mine
                    ? 'bg-bubble-user text-bubble-user-ink'
                    : 'bg-bubble-other text-ink',
              )}
            >
              {text}
              {streaming ? <StreamCursor reduceMotion={reduceMotion} /> : null}
            </div>
          )
        ) : null}

        {isAvatar && showExplain && message.aiMeta?.explanation ? (
          <div className="w-full rounded-md border border-line bg-panel p-2.5 text-[12px] backdrop-blur">
            <div className="mb-1 flex items-center gap-1 font-medium text-brand">
              <RiMagicLine className="size-3" />
              为什么这么回
            </div>
            <p className="leading-relaxed text-ink-tertiary">{message.aiMeta.explanation.reason}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-tertiary">
              <span>置信度 {(message.aiMeta.explanation.confidence * 100).toFixed(0)}%</span>
              {message.aiMeta.explanation.toolsUsed.length > 0 ? (
                <span>· 工具：{message.aiMeta.explanation.toolsUsed.join('、')}</span>
              ) : null}
              {message.aiMeta.explanation.memoriesUsed.length > 0 ? (
                <span>· 记忆 {message.aiMeta.explanation.memoriesUsed.length} 条</span>
              ) : null}
            </div>
            {message.aiMeta.explanation.memoriesUsed.length > 0 ? (
              <ul className="mt-2 space-y-0.5 text-[11px] text-ink-tertiary">
                {Array.from(new Set(message.aiMeta.explanation.memoriesUsed))
                  .slice(0, 4)
                  .map((m) => (
                    <li key={m}>· {m}</li>
                  ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {/* 悬浮操作 */}
        <div
          className={cn(
            'flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100',
            mine ? 'flex-row-reverse' : '',
          )}
        >
          {isAvatar ? (
            <>
              <Button variant="ghost" size="icon-sm" title="点赞" onClick={() => feedback('like')}>
                <RiThumbUpLine className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="纠正回复"
                onClick={() => setCorrectOpen(true)}
              >
                <RiMagicLine className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title="举报"
                onClick={() => feedback('report')}
              >
                <RiFlagLine className="size-3" />
              </Button>
            </>
          ) : null}
          {!message.recalled ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-sm" title="更多操作" />}
              >
                <RiMoreFill className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => onReply?.(message.msgId, text.slice(0, 60))}>
                  <RiReplyLine className="size-3.5" /> 回复
                </DropdownMenuItem>
                {canRecall ? (
                  <DropdownMenuItem
                    onClick={() => {
                      getRealtimeClient()?.recall(message.msgId);
                      toast.show('已请求撤回');
                    }}
                  >
                    <RiArrowGoBackLine className="size-3.5" /> 撤回消息
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      <Dialog open={correctOpen} onOpenChange={setCorrectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>纠正分身的回复</DialogTitle>
          </DialogHeader>
          <p className="mb-2 text-xs text-muted-foreground">原回复：{text.slice(0, 120)}</p>
          <Textarea
            placeholder="你希望它怎么回？（这条纠正会进入偏好学习）"
            value={correctText}
            onChange={(e) => setCorrectText(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button
              disabled={!correctText.trim()}
              onClick={() => {
                void api
                  .feedback(message.msgId, { type: 'correct', correctedText: correctText.trim() })
                  .then(() => {
                    toast.success('已记录纠正，分身会学习');
                    setCorrectOpen(false);
                    setCorrectText('');
                  })
                  .catch((e) => toast.error('提交失败', String(e)));
              }}
            >
              提交纠正
            </Button>
            <Button variant="ghost" onClick={() => setCorrectOpen(false)}>
              取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 流式光标：motion 呼吸；减少动态偏好时退化为静态字符 */
function StreamCursor({ reduceMotion }: { reduceMotion: boolean }) {
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
