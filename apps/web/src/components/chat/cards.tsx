import { contentText } from '@chappie/contract';
import { api, type CardPayload, dayjs, RISK_LABELS } from '@chappie/shared';
import {
  RiAlertLine,
  RiArrowRightLine,
  RiCheckboxCircleLine,
  RiCheckLine,
  RiCloseCircleLine,
  RiDraftLine,
  RiLoader4Line,
  RiShieldKeyholeLine,
  RiTaskLine,
  RiTimeLine,
} from '@remixicon/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

interface CardViewProps {
  msgId: string;
  card: CardPayload;
}

async function act(
  msgId: string,
  action: 'send' | 'edit' | 'discard' | 'approve' | 'modify_approve' | 'reject' | 'cancel',
  editedText?: string,
) {
  await api.cardAction(msgId, { action, editedText });
}

export function CardView({ msgId, card }: CardViewProps) {
  switch (card.kind) {
    case 'draft':
      return <DraftCardView msgId={msgId} card={card} />;
    case 'approval':
      return <ApprovalCardView msgId={msgId} card={card} />;
    case 'task':
      return <TaskCardView msgId={msgId} card={card} />;
    case 'report':
      return <ReportCardView card={card} />;
    case 'handover':
      return <HandoverCardView card={card} />;
    default:
      return null;
  }
}

function CardShell({
  icon,
  title,
  badge,
  children,
  tone = 'default',
}: {
  icon: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  tone?: 'default' | 'warning' | 'danger';
}) {
  return (
    <Card
      className={cn(
        'w-full max-w-md overflow-hidden',
        tone === 'warning' && 'border-warning/40',
        tone === 'danger' && 'border-destructive/40',
      )}
    >
      <CardHeader className="flex-row items-center gap-2 space-y-0 pb-2">
        <span
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md',
            tone === 'warning'
              ? 'bg-warning/15 text-warning'
              : tone === 'danger'
                ? 'bg-destructive/15 text-destructive'
                : 'bg-primary/10 text-primary',
          )}
        >
          {icon}
        </span>
        <CardTitle className="flex-1 text-sm">{title}</CardTitle>
        {badge}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 草稿卡片
// ---------------------------------------------------------------------------

function DraftCardView({
  msgId,
  card,
}: {
  msgId: string;
  card: Extract<CardPayload, { kind: 'draft' }>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(card.draftText);
  const expired = card.expiresAt ? dayjs(card.expiresAt).isBefore(dayjs()) : false;

  const run = async (action: 'send' | 'edit' | 'discard', editedText?: string) => {
    setBusy(action);
    try {
      await act(msgId, action, editedText);
      setDone(action);
      toast.success(action === 'discard' ? '草稿已丢弃' : '已发送');
    } catch (e) {
      toast.error('操作失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <CardShell
      icon={<RiDraftLine className="size-4" />}
      title="草稿建议"
      badge={<Badge variant="ai">待你确认</Badge>}
    >
      {card.reason ? (
        <CardDescription className="mb-2 text-xs">{card.reason}</CardDescription>
      ) : null}
      <div className="rounded-md border border-line bg-surface-veil p-3 text-sm leading-relaxed whitespace-pre-wrap">
        {text}
      </div>

      {expired ? (
        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <RiTimeLine className="size-3" /> 草稿已过期
        </p>
      ) : done ? (
        <p className="mt-2 flex items-center gap-1 text-xs text-success">
          <RiCheckLine className="size-3" />
          {done === 'discard' ? '已丢弃' : '已发送'}
        </p>
      ) : editing ? (
        <div className="mt-3 space-y-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy !== null} onClick={() => void run('edit', text)}>
              {busy === 'edit' ? <RiLoader4Line className="size-3 animate-spin" /> : null}
              发送修改版
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              取消
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={busy !== null} onClick={() => void run('send')}>
            {busy === 'send' ? (
              <RiLoader4Line className="size-3 animate-spin" />
            ) : (
              <RiCheckLine className="size-3" />
            )}
            直接发送
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => setEditing(true)}
          >
            修改后发送
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => void run('discard')}
          >
            丢弃
          </Button>
        </div>
      )}
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// 确认卡片（L2 审批）
// ---------------------------------------------------------------------------

function ApprovalCardView({
  msgId,
  card,
}: {
  msgId: string;
  card: Extract<CardPayload, { kind: 'approval' }>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [modifying, setModifying] = useState(false);
  const [edited, setEdited] = useState(JSON.stringify(card.args, null, 2));
  const expired = card.expiresAt ? dayjs(card.expiresAt).isBefore(dayjs()) : false;

  const run = async (action: 'approve' | 'modify_approve' | 'reject', editedText?: string) => {
    setBusy(action);
    try {
      await act(msgId, action, editedText);
      setDone(action);
      toast.success(
        action === 'reject'
          ? '已拒绝'
          : action === 'approve'
            ? '已批准，分身继续执行'
            : '已按修改执行',
      );
    } catch (e) {
      toast.error('操作失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <CardShell
      icon={<RiShieldKeyholeLine className="size-4" />}
      title={card.title}
      tone="warning"
      badge={
        <Badge variant={card.risk === 'L2' ? 'warning' : 'muted'}>
          {card.risk} · {RISK_LABELS[card.risk] ?? card.risk}
        </Badge>
      }
    >
      <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
        {card.summary}
      </p>
      <div className="mt-2 rounded-md border border-line bg-surface-veil p-2 text-xs">
        <div className="mb-1 font-medium text-muted-foreground">工具：{card.toolName}</div>
        <pre className="scrollbar-thin max-h-28 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">
          {JSON.stringify(card.args, null, 2)}
        </pre>
      </div>

      {expired ? (
        <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
          <RiTimeLine className="size-3" /> 请求已过期
        </p>
      ) : done ? (
        <p
          className={cn(
            'mt-2 flex items-center gap-1 text-xs',
            done === 'reject' ? 'text-destructive' : 'text-success',
          )}
        >
          {done === 'reject' ? (
            <RiCloseCircleLine className="size-3" />
          ) : (
            <RiCheckboxCircleLine className="size-3" />
          )}
          {done === 'reject' ? '已拒绝' : done === 'approve' ? '已批准' : '已修改并批准'}
        </p>
      ) : modifying ? (
        <div className="mt-3 space-y-2">
          <Textarea
            value={edited}
            onChange={(e) => setEdited(e.target.value)}
            rows={4}
            className="font-mono text-xs"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() => void run('modify_approve', edited)}
            >
              {busy === 'modify_approve' ? <RiLoader4Line className="size-3 animate-spin" /> : null}
              按修改批准
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setModifying(false)}>
              取消
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={busy !== null} onClick={() => void run('approve')}>
            {busy === 'approve' ? (
              <RiLoader4Line className="size-3 animate-spin" />
            ) : (
              <RiCheckLine className="size-3" />
            )}
            批准
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => setModifying(true)}
          >
            修改后批准
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => void run('reject')}
          >
            拒绝
          </Button>
        </div>
      )}
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// 任务卡片
// ---------------------------------------------------------------------------

function TaskCardView({
  msgId,
  card,
}: {
  msgId: string;
  card: Extract<CardPayload, { kind: 'task' }>;
}) {
  const [busy, setBusy] = useState(false);
  const statusLabel: Record<string, string> = {
    running: '进行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  };
  return (
    <CardShell
      icon={<RiTaskLine className="size-4" />}
      title={card.title}
      badge={
        <Badge
          variant={
            card.status === 'completed'
              ? 'success'
              : card.status === 'failed'
                ? 'destructive'
                : 'muted'
          }
        >
          {statusLabel[card.status] ?? card.status}
        </Badge>
      }
    >
      <div className="space-y-1.5">
        {card.steps.map((s, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            {s.status === 'done' ? (
              <RiCheckboxCircleLine className="mt-0.5 size-3.5 text-success" />
            ) : s.status === 'running' ? (
              <RiLoader4Line className="mt-0.5 size-3.5 animate-spin text-primary" />
            ) : s.status === 'failed' ? (
              <RiCloseCircleLine className="mt-0.5 size-3.5 text-destructive" />
            ) : (
              <RiTimeLine className="mt-0.5 size-3.5 text-muted-foreground" />
            )}
            <div>
              <div>{s.name}</div>
              {s.detail ? <div className="text-muted-foreground">{s.detail}</div> : null}
            </div>
          </div>
        ))}
      </div>
      {card.status === 'running' ? (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void act(msgId, 'cancel')
              .then(() => toast.success('已请求取消任务'))
              .catch((e) => toast.error('取消失败', String(e)))
              .finally(() => setBusy(false));
          }}
        >
          取消任务
        </Button>
      ) : null}
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// 日报 / 转交卡片
// ---------------------------------------------------------------------------

function ReportCardView({ card }: { card: Extract<CardPayload, { kind: 'report' }> }) {
  const navigate = useNavigate();
  return (
    <CardShell
      icon={<RiTaskLine className="size-4" />}
      title={`分身日报 · ${card.day}`}
      badge={<Badge variant="ai">日报</Badge>}
    >
      <p className="text-sm leading-relaxed whitespace-pre-wrap">{card.summary}</p>
      <Button size="sm" variant="outline" className="mt-3" onClick={() => navigate('/reports')}>
        查看完整日报 <RiArrowRightLine className="size-3" />
      </Button>
    </CardShell>
  );
}

function HandoverCardView({ card }: { card: Extract<CardPayload, { kind: 'handover' }> }) {
  return (
    <CardShell
      icon={<RiAlertLine className="size-4" />}
      title="转交给你处理"
      tone="warning"
      badge={<Badge variant="warning">需人工</Badge>}
    >
      <p className="text-sm leading-relaxed whitespace-pre-wrap">{card.summary}</p>
      {card.reason ? (
        <p className="mt-2 text-xs text-muted-foreground">原因：{card.reason}</p>
      ) : null}
    </CardShell>
  );
}

export { contentText };
