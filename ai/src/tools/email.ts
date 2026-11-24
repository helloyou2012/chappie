/**
 * 邮件工具：
 *   email.send  —— 通过 Resend 真实发送（L2 审批）
 *   email.list / email.read —— 读取 /webhooks/inbound-email 落库的入站邮件（L0）
 */
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../common/config';
import { db } from '../common/db';
import { inboundEmail } from '../db/schema';
import type { BuiltinTool } from '../tool-gateway';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const emailTools: BuiltinTool[] = [
  {
    id: 'email.send',
    name: '发送邮件',
    description: '以主人配置的发件人身份发送一封邮件（需主人确认）',
    risk: 'L2',
    idempotent: false,
    jsonSchema: {
      type: 'object',
      required: ['to', 'subject', 'text'],
      properties: {
        to: { type: 'string', description: '收件人邮箱' },
        subject: { type: 'string', description: '邮件主题' },
        text: { type: 'string', description: '纯文本正文' },
      },
    },
    validate: z.object({
      to: z.string().regex(EMAIL_RE, '邮箱格式不合法'),
      subject: z.string().min(1).max(200),
      text: z.string().min(1).max(10000),
    }),
    async exec(args) {
      if (!config.resendApiKey) {
        return { ok: false, summary: '邮件发送未配置：缺少 RESEND_API_KEY。' };
      }
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.resendApiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: config.mailFrom,
          to: [String(args.to)],
          subject: String(args.subject),
          text: String(args.text),
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await res.text().catch(() => '');
      if (!res.ok) {
        return { ok: false, summary: `邮件发送失败：HTTP ${res.status} ${body.slice(0, 200)}` };
      }
      let id = '';
      try {
        id = (JSON.parse(body) as { id?: string }).id ?? '';
      } catch {
        // 忽略非 JSON 响应
      }
      return {
        ok: true,
        emailId: id,
        summary: `已向 ${String(args.to)} 发送邮件「${String(args.subject)}」${
          id ? `（${id}）` : ''
        }。`,
      };
    },
  },
  {
    id: 'email.list',
    name: '查看收件箱',
    description: '查看最近收到的邮件（入站邮件 webhook 落库）',
    risk: 'L0',
    idempotent: true,
    jsonSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '返回条数，默认 10，最大 20' },
      },
    },
    validate: z.object({ limit: z.number().int().min(1).max(20).optional() }),
    async exec(args, ctx) {
      const limit = Math.min(Number(args.limit ?? 10), 20);
      const rows = await db
        .select({
          id: inboundEmail.id,
          fromAddr: inboundEmail.fromAddr,
          subject: inboundEmail.subject,
          receivedAt: inboundEmail.receivedAt,
        })
        .from(inboundEmail)
        .where(eq(inboundEmail.ownerId, ctx.ownerId))
        .orderBy(desc(inboundEmail.receivedAt))
        .limit(limit);
      return {
        summary:
          rows.length === 0
            ? '收件箱里还没有收到邮件。'
            : `最近 ${rows.length} 封邮件：${rows
                .slice(0, 5)
                .map((r) => `「${r.subject}」来自 ${r.fromAddr}`)
                .join('；')}`,
        items: rows.map((r) => ({
          id: r.id,
          from: r.fromAddr,
          subject: r.subject,
          receivedAt: r.receivedAt,
        })),
      };
    },
  },
  {
    id: 'email.read',
    name: '读取邮件',
    description: '按 id 读取一封入站邮件的正文',
    risk: 'L0',
    idempotent: true,
    jsonSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', description: 'email.list 返回的邮件 id' } },
    },
    validate: z.object({ id: z.string().min(1) }),
    async exec(args, ctx) {
      const rows = await db
        .select()
        .from(inboundEmail)
        .where(eq(inboundEmail.id, String(args.id)))
        .limit(1);
      const row = rows[0];
      if (!row || row.ownerId !== ctx.ownerId) {
        return { ok: false, summary: '邮件不存在或不属于你。' };
      }
      const body = row.textBody.slice(0, 6000);
      return {
        ok: true,
        id: row.id,
        from: row.fromAddr,
        to: row.toAddr,
        subject: row.subject,
        receivedAt: row.receivedAt,
        text: body,
        summary: `「${row.subject}」来自 ${row.fromAddr}：${body.slice(0, 240)}`,
      };
    },
  },
];
