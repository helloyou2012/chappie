/**
 * 联系人与代发消息工具（完全本地实现）。
 * message.send 为 L2：主人确认后，以分身代发身份写入对方单聊。
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../common/config';
import { db } from '../common/db';
import { internal } from '../common/internal';
import { newId } from '../common/log';
import { contact, conversationReception, user } from '../db/schema';
import type { BuiltinTool, ToolContext } from '../tool-gateway';

export interface ContactMatch {
  userId: string;
  name: string;
  alias: string | null;
  email: string;
}

/** 在主人联系人里按备注名/姓名/邮箱匹配（大小写不敏感）。 */
export async function resolveContactMatches(
  ownerId: string,
  query: string,
): Promise<ContactMatch[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const rows = await db
    .select({
      userId: contact.peerId,
      alias: contact.alias,
      name: user.name,
      email: user.email,
    })
    .from(contact)
    .innerJoin(user, eq(user.id, contact.peerId))
    .where(eq(contact.userId, ownerId));
  return rows.filter((r) =>
    [r.name, r.alias ?? '', r.email].some((v) => v.toLowerCase().includes(q)),
  );
}

export function contactLabel(c: ContactMatch): string {
  return c.alias ? `${c.alias}（${c.name}）` : c.name;
}

/**
 * 确保目标单聊存在主人的接待态行（core 的 enforce_avatar_send 要求行存在；
 * 已有行不覆盖，避免改写主人对该联系人的策略）。
 */
async function ensureReception(ownerId: string, convId: string): Promise<number> {
  const rows = await db
    .select({ version: conversationReception.version })
    .from(conversationReception)
    .where(
      and(eq(conversationReception.convId, convId), eq(conversationReception.ownerId, ownerId)),
    )
    .limit(1);
  if (rows[0]) return Number(rows[0].version);
  const rec = await internal.setReception({
    ownerId,
    convId,
    state: 'avatar',
    strategy: 'summon',
    reason: 'message.send',
  });
  return rec.version;
}

async function sendAsAvatar(params: {
  ctx: ToolContext;
  convId: string;
  text: string;
  authorityVersion: number;
}): Promise<string> {
  const msg = await internal.sendMessage(
    {
      clientMsgId: newId('tool'),
      convId: params.convId,
      senderId: params.ctx.avatarId,
      onBehalfOf: params.ctx.ownerId,
      content: { type: 'text', schemaVersion: 1, text: params.text },
      mentions: [],
      replyTo: null,
      aiMeta: {
        taskId: params.ctx.taskId,
        mode: 'auto',
        toolsUsed: ['message.send'],
        risk: 'L2',
        confidence: 1,
        hopCount: 1,
        authorityVersion: params.authorityVersion,
        via: 'owner_approved',
        explanation: {
          decision: 'reply',
          reason: '主人批准的代发消息工具',
          confidence: 1,
          toolsUsed: ['message.send'],
          memoriesUsed: [],
        },
      },
      authorityVersion: params.authorityVersion,
      via: 'owner_approved',
    },
    params.ctx.traceId,
  );
  return msg.msgId;
}

export const contactTools: BuiltinTool[] = [
  {
    id: 'contact.search',
    name: '查找联系人',
    description: '在主人的联系人中按姓名、备注名或邮箱查找',
    risk: 'L0',
    idempotent: true,
    jsonSchema: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string', description: '姓名、备注名或邮箱关键词' } },
    },
    validate: z.object({ query: z.string().min(1).max(100) }),
    async exec(args, ctx) {
      const matches = await resolveContactMatches(ctx.ownerId, String(args.query));
      return {
        summary:
          matches.length === 0
            ? `没有找到匹配「${String(args.query)}」的联系人。`
            : `找到 ${matches.length} 位联系人：${matches
                .slice(0, 8)
                .map(contactLabel)
                .join('、')}`,
        items: matches.slice(0, 8).map((m) => ({
          name: contactLabel(m),
          email: m.email,
        })),
      };
    },
  },
  {
    id: 'message.send',
    name: '代发消息',
    description: '以主人的分身身份，给主人的某个联系人发送一条文本消息（需主人确认）',
    risk: 'L2',
    idempotent: false,
    jsonSchema: {
      type: 'object',
      required: ['to', 'text'],
      properties: {
        to: { type: 'string', description: '联系人姓名、备注名或邮箱' },
        text: { type: 'string', description: '要发送的消息内容' },
      },
    },
    validate: z.object({
      to: z.string().min(1).max(100),
      text: z.string().min(1).max(2000),
    }),
    async exec(args, ctx) {
      const matches = await resolveContactMatches(ctx.ownerId, String(args.to));
      if (matches.length === 0) {
        return {
          ok: false,
          summary: `没找到联系人「${String(args.to)}」，请先添加联系人。`,
        };
      }
      if (matches.length > 1) {
        return {
          ok: false,
          summary: `找到多个匹配「${String(args.to)}」的联系人（${matches
            .map(contactLabel)
            .join('、')}），请说得更具体一些。`,
        };
      }
      const target = matches[0]!;
      const { convId } = await internal.ensureDirect(ctx.ownerId, target.userId);
      const version = await ensureReception(ctx.ownerId, convId);
      const messageId = await sendAsAvatar({
        ctx,
        convId,
        text: String(args.text),
        authorityVersion: version,
      });
      return {
        ok: true,
        convId,
        messageId,
        summary: `已代你给 ${contactLabel(target)} 发送消息。`,
      };
    },
  },
];
