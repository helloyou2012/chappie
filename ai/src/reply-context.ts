/**
 * 把某条消息、某个观察者分身的上下文序列化成 mmBERT 输入。
 * 必须与 training/serialize.py 完全一致。
 */
import { ALL_MENTION_ID, contentText, type Message } from '@chappie/contract';
import { dayjs } from './common/datetime';

export interface ReplyMember {
  principalId: string;
  name: string;
  principalType: string;
  ownerId?: string | null;
  jobRole?: string;
  department?: string;
}

export interface ReplyContextInput {
  convType: 'group' | 'direct';
  observer: {
    id: string;
    name: string;
    ownerName: string;
    ownerRole?: string;
    ownerDepartment?: string;
    mode: string;
  };
  members: ReplyMember[];
  messages: Message[];
  trigger: Message;
}

function clip(text: string, n: number): string {
  const chars = Array.from((text ?? '').replace(/\n/g, ' ').trim());
  return chars.length > n ? `${chars.slice(0, n).join('')}…` : chars.join('');
}

function typeLabel(type: string): string {
  return type === 'avatar' ? '分身' : type === 'human' ? '真人' : type;
}

function personLabel(name: string, role?: string, department?: string): string {
  const parts = [role, department].filter(Boolean);
  return parts.length > 0 ? `${name}（${parts.join('，')}）` : name;
}

function mentionSuffix(ids: string[] | undefined, members: ReplyMember[]): string {
  if (!ids?.length) return '';
  const parts = ids.map((id) => {
    if (id === ALL_MENTION_ID) return '所有人·广播';
    const m = members.find((x) => x.principalId === id);
    return m ? `${m.name}·${typeLabel(m.principalType)}` : id;
  });
  return `（@${parts.join('、')}）`;
}

export function buildReplyContext(input: ReplyContextInput): string {
  const { observer, members, messages, trigger, convType } = input;
  const byId = new Map(members.map((m) => [m.principalId, m]));
  const lines: string[] = [];
  lines.push(convType === 'group' ? '[群聊]' : '[私聊]');
  lines.push(
    `观察者：${observer.name} 的 AI 分身（主人：${personLabel(
      observer.ownerName,
      observer.ownerRole,
      observer.ownerDepartment,
    )}；模式：${observer.mode}）`,
  );
  lines.push(
    `成员：${members
      .map((m) => {
        const extra = m.principalId === observer.id ? '，观察者' : '';
        return `${personLabel(m.name, m.jobRole, m.department)}(${typeLabel(m.principalType)}${extra})`;
      })
      .join('、')}`,
  );
  lines.push('最近消息：');
  for (const msg of messages
    .filter((m) => m.msgId !== trigger.msgId && m.seq < trigger.seq)
    .slice(-5)) {
    const sender = byId.get(msg.senderId);
    const senderName = sender?.name ?? msg.senderId;
    const senderType = sender?.principalType ?? msg.senderType;
    lines.push(
      `[${dayjs(msg.createdAt).format('HH:mm')}] ` +
        `${personLabel(senderName, sender?.jobRole, sender?.department)}(${typeLabel(senderType)})：` +
        `${clip(contentText(msg.content), 120)}${mentionSuffix(msg.mentions, members)}`,
    );
  }
  const triggerSender = byId.get(trigger.senderId);
  lines.push(`观察者是否被 @：${trigger.mentions?.includes(observer.id) ? '是' : '否'}`);
  lines.push('当前消息：');
  lines.push(
    `[${dayjs(trigger.createdAt).format('HH:mm')}] ` +
      `${triggerSender?.name ?? trigger.senderId}(${typeLabel(triggerSender?.principalType ?? trigger.senderType)})：` +
      `${clip(contentText(trigger.content), 240)}${mentionSuffix(trigger.mentions, members)}`,
  );
  lines.push('请判断：观察者是否应该回复当前消息？');
  return lines.join('\n');
}
