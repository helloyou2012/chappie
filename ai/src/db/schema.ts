/**
 * Drizzle schema —— ai-platform 拥有的表（可写）+ 只读的 core 表。
 *
 * 约定：
 *   - 列名与 `ai/migrations/*.sql` 保持一致（迁移仍由 SQL 管理，schema 用于类型安全访问）；
 *   - 属性名为 camelCase（Drizzle 自动映射），JSONB 列通过 `$type<T>()` 标注业务类型；
 *   - core 表（outbox 除外）仅用于 SELECT，写入一律走 im-core（单写者原则）。
 */
import type {
  AgentTask as AgentTaskApi,
  Approval as ApprovalApi,
  DailyReport as DailyReportApi,
  MemoryItem as MemoryItemApi,
  PolicyRule,
  RiskLevel,
} from '@chappie/contract';
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------------------
// AI 平台自有表
// ---------------------------------------------------------------------------

export const avatar = pgTable('avatar', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  name: text('name').notNull(),
  persona: text('persona').notNull().default(''),
  modelProfile: text('model_profile').notNull().default('default'),
  status: text('status').notNull().default('active'),
  selfConvId: text('self_conv_id'),
  dailyBudgetUsd: numeric('daily_budget_usd', { precision: 10, scale: 4 }).notNull().default('1.0'),
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const policy = pgTable('policy', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  scopeType: text('scope_type').notNull(),
  scopeId: text('scope_id'),
  name: text('name').notNull().default(''),
  rule: jsonb('rule').$type<PolicyRule>().notNull(),
  priority: integer('priority').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const capability = pgTable('capability', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  schema: jsonb('schema').$type<Record<string, unknown>>().notNull().default({}),
  riskLevel: text('risk_level').$type<RiskLevel>().notNull(),
  provider: text('provider').notNull().default('builtin'),
  version: integer('version').notNull().default(1),
});

export const capabilityGrant = pgTable(
  'capability_grant',
  {
    avatarId: text('avatar_id').notNull(),
    capabilityId: text('capability_id').notNull(),
    granted: boolean('granted').notNull().default(true),
    constraints: jsonb('constraints').$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.avatarId, t.capabilityId] })],
);

export const agentTask = pgTable(
  'agent_task',
  {
    id: text('id').primaryKey(),
    avatarId: text('avatar_id').notNull(),
    ownerId: text('owner_id').notNull(),
    triggerMsgId: text('trigger_msg_id'),
    triggerConvId: text('trigger_conv_id'),
    triggerKind: text('trigger_kind').notNull(),
    status: text('status').notNull(),
    plan: jsonb('plan').$type<unknown>(),
    result: text('result'),
    decision: jsonb('decision').$type<AgentTaskApi['decision']>(),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
    tokensUsed: integer('tokens_used').notNull().default(0),
    traceId: text('trace_id'),
    error: text('error'),
    context: jsonb('context').$type<Record<string, unknown>>(),
    /** 任务租约：崩溃检测与恢复认领（设计方案 §27.4 中断恢复） */
    lockedBy: text('locked_by'),
    leaseUntil: ts('lease_until'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('agent_task_trigger_avatar_uq').on(t.triggerMsgId, t.avatarId),
    index('agent_task_avatar_time_idx').on(t.avatarId, t.createdAt),
  ],
);

export const taskStep = pgTable('task_step', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  taskId: text('task_id').notNull(),
  idx: integer('idx').notNull(),
  type: text('type').notNull(),
  input: jsonb('input').$type<unknown>(),
  output: jsonb('output').$type<unknown>(),
  model: text('model'),
  tokens: integer('tokens'),
  latencyMs: integer('latency_ms'),
  /** 工具幂等账本键（type='tool'/'tool_pending'）：恢复时按 (task_id, tool_call_id) 查重复用 */
  toolCallId: text('tool_call_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const approval = pgTable('approval', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  avatarId: text('avatar_id').notNull(),
  approver: text('approver').notNull(),
  title: text('title').notNull(),
  toolName: text('tool_name').notNull(),
  args: jsonb('args').$type<Record<string, unknown>>().notNull().default({}),
  status: text('status').$type<ApprovalApi['status']>().notNull(),
  modifiedArgs: jsonb('modified_args').$type<Record<string, unknown>>(),
  cardMsgId: text('card_msg_id'),
  result: jsonb('result').$type<unknown>(),
  expiresAt: ts('expires_at').notNull(),
  resolvedAt: ts('resolved_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  taskId: text('task_id'),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  params: jsonb('params').$type<unknown>(),
  result: jsonb('result').$type<unknown>(),
  risk: text('risk'),
  prevHash: text('prev_hash'),
  hash: text('hash'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const memoryItem = pgTable(
  'memory_item',
  {
    id: text('id').primaryKey(),
    avatarId: text('avatar_id').notNull(),
    scope: text('scope').$type<MemoryItemApi['scope']>().notNull(),
    peerId: text('peer_id'),
    type: text('type').$type<MemoryItemApi['type']>().notNull(),
    content: text('content').notNull(),
    embedding: real('embedding').array(),
    keywords: text('keywords').array().notNull().default(sql`'{}'::text[]`),
    sensitivity: text('sensitivity')
      .$type<MemoryItemApi['sensitivity']>()
      .notNull()
      .default('normal'),
    confidence: real('confidence').notNull().default(0.8),
    sourceMsgId: text('source_msg_id'),
    expiresAt: ts('expires_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('memory_scope_idx').on(t.avatarId, t.scope, t.peerId)],
);

export const styleProfile = pgTable('style_profile', {
  avatarId: text('avatar_id').primaryKey(),
  features: jsonb('features').$type<Record<string, unknown>>().notNull().default({}),
  examples: jsonb('examples').$type<string[]>().notNull().default([]),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const feedback = pgTable('feedback', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  msgId: text('msg_id').notNull(),
  taskId: text('task_id'),
  actor: text('actor').notNull(),
  type: text('type').notNull(),
  diff: text('diff'),
  reason: text('reason'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const usageDaily = pgTable(
  'usage_daily',
  {
    avatarId: text('avatar_id').notNull(),
    day: date('day').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    requests: integer('requests').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.avatarId, t.day, t.provider, t.model] })],
);

export const schedulerJob = pgTable('scheduler_job', {
  id: text('id').primaryKey(),
  avatarId: text('avatar_id').notNull(),
  kind: text('kind').notNull(),
  schedule: text('schedule').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: ts('last_run_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const dailyReport = pgTable(
  'daily_report',
  {
    id: text('id').primaryKey(),
    avatarId: text('avatar_id').notNull(),
    ownerId: text('owner_id').notNull(),
    day: date('day').notNull(),
    summary: text('summary').notNull(),
    stats: jsonb('stats').$type<DailyReportApi['stats']>().notNull().default(sql`'{}'::jsonb`),
    pendingDecisions: jsonb('pending_decisions')
      .$type<DailyReportApi['pendingDecisions']>()
      .notNull()
      .default([]),
    cardMsgId: text('card_msg_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('daily_report_avatar_day_uq').on(t.avatarId, t.day)],
);

export const toolData = pgTable(
  'tool_data',
  {
    avatarId: text('avatar_id').notNull(),
    kind: text('kind').notNull(),
    data: jsonb('data').$type<unknown>().notNull().default([]),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.avatarId, t.kind] })],
);

export const schemaMigrationsAi = pgTable('schema_migrations_ai', {
  name: text('name').primaryKey(),
  appliedAt: ts('applied_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// 只读 core 表（im-core 拥有；Bun 仅 SELECT，outbox 除外由消费者更新状态）
// ---------------------------------------------------------------------------

export const outbox = pgTable('outbox', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  topic: text('topic').notNull(),
  key: text('key'),
  payload: jsonb('payload')
    .$type<{
      eventId: string;
      topic: string;
      key: string | null;
      traceId: string | null;
      occurredAt: string;
      data: unknown;
    }>()
    .notNull(),
  traceId: text('trace_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
  lockedAt: ts('locked_at'),
  lockedBy: text('locked_by'),
  attempts: integer('attempts').notNull().default(0),
  doneAt: ts('done_at'),
});

export const member = pgTable(
  'member',
  {
    convId: text('conv_id').notNull(),
    principalId: text('principal_id').notNull(),
    role: text('role').notNull(),
    aiMode: text('ai_mode').notNull(),
    aiModeUntil: ts('ai_mode_until'),
    lastReadSeq: integer('last_read_seq').notNull().default(0),
    joinedAt: ts('joined_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.convId, t.principalId] })],
);

export const message = pgTable('message', {
  msgId: text('msg_id').primaryKey(),
  convId: text('conv_id').notNull(),
  seq: integer('seq').notNull(),
  senderId: text('sender_id').notNull(),
  senderType: text('sender_type').notNull(),
  onBehalfOf: text('on_behalf_of'),
  content: jsonb('content').$type<Record<string, unknown>>().notNull(),
  mentions: text('mentions').array().notNull().default(sql`'{}'::text[]`),
  replyTo: text('reply_to'),
  aiMeta: jsonb('ai_meta').$type<Record<string, unknown> | null>(),
  clientMsgId: text('client_msg_id').notNull(),
  recalled: boolean('recalled').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const conversation = pgTable('conversation', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  title: text('title'),
  systemTag: text('system_tag'),
  lastSeq: integer('last_seq').notNull().default(0),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  aiSettings: jsonb('ai_settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: ts('created_at').notNull().defaultNow(),
});
