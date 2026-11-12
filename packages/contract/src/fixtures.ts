/**
 * 契约 fixtures —— 每种消息/帧的权威样例。
 *
 * 双侧契约测试的数据源（防 TS 与 Rust 类型漂移，见计划「关键决策」）：
 *   - TS 侧：bun test 对每个 fixture 做 zod parse；
 *   - Rust 侧：集成测试读取导出的 fixtures.json 做 serde 往返校验。
 * 修改契约字段时必须同步更新这里，并重新运行 `pnpm --filter @chappie/contract export:fixtures`。
 */

import type { AgentTask, Approval, DailyReport, MemoryItem, Policy } from './ai';
import type { Conversation, Member, Message } from './chat';
import type { DeviceCapabilities, DeviceRegistration } from './device';
import type { ClientFrame, ServerFrame } from './frames';
import type { Avatar, Principal, User } from './identity';

export const fixtureUser: User = {
  id: 'u_00000000-0000-4000-8000-000000000001',
  email: 'alice@demo.dev',
  name: 'Alice',
  avatarUrl: null,
  createdAt: '2026-11-01T08:00:00.000Z',
};

export const fixtureAvatar: Avatar = {
  id: 'a_00000000-0000-4000-8000-000000000001',
  ownerId: 'u_00000000-0000-4000-8000-000000000001',
  name: 'Alice 的分身',
  persona: '你是 Alice 的 AI 分身，语气亲切简洁，喜欢用表情符号。',
  modelProfile: 'default',
  status: 'active',
  selfConvId: 'c_00000000-0000-4000-8000-000000000010',
  dailyBudgetUsd: 1,
  version: 1,
};

export const fixturePrincipal: Principal = {
  id: 'a_00000000-0000-4000-8000-000000000001',
  type: 'avatar',
  ownerId: 'u_00000000-0000-4000-8000-000000000001',
  name: 'Alice 的分身',
  status: 'active',
};

export const fixtureConversation: Conversation = {
  id: 'c_00000000-0000-4000-8000-000000000001',
  type: 'direct',
  title: null,
  systemTag: null,
  lastSeq: 42,
  createdAt: '2026-11-01T08:00:00.000Z',
};

export const fixtureMember: Member = {
  convId: 'c_00000000-0000-4000-8000-000000000001',
  principalId: 'u_00000000-0000-4000-8000-000000000001',
  role: 'member',
  aiMode: 'auto',
  aiModeUntil: '2026-11-11T20:00:00.000Z',
  lastReadSeq: 40,
  joinedAt: '2026-11-01T08:00:00.000Z',
};

export const fixtureDeviceCapabilities: DeviceCapabilities = {
  notifications: true,
  camera: true,
  photoLibrary: true,
  files: true,
  clipboard: true,
  location: false,
  localNetwork: false,
  share: true,
  biometrics: true,
};

export const fixtureDeviceRegistration: DeviceRegistration = {
  deviceId: 'dev_00000000-0000-4000-8000-000000000001',
  platform: 'web',
  appVersion: '0.1.0',
  capabilities: fixtureDeviceCapabilities,
  pushToken: null,
};

/** 人类消息 */
export const fixtureHumanMessage: Message = {
  msgId: 'm_00000000-0000-4000-8000-000000000001',
  convId: 'c_00000000-0000-4000-8000-000000000001',
  seq: 41,
  clientMsgId: 'cm_00000000-0000-4000-8000-000000000011',
  senderId: 'u_00000000-0000-4000-8000-000000000002',
  senderType: 'human',
  onBehalfOf: null,
  content: { type: 'text', schemaVersion: 1, text: '明天上午有什么安排？' },
  mentions: [],
  replyTo: null,
  aiMeta: null,
  recalled: false,
  createdAt: '2026-11-11T02:00:00.000Z',
};

/** 分身代发消息（含解释元信息） */
export const fixtureAvatarMessage: Message = {
  msgId: 'm_00000000-0000-4000-8000-000000000002',
  convId: 'c_00000000-0000-4000-8000-000000000001',
  seq: 42,
  clientMsgId: null,
  senderId: 'a_00000000-0000-4000-8000-000000000001',
  senderType: 'avatar',
  onBehalfOf: 'u_00000000-0000-4000-8000-000000000001',
  content: {
    type: 'text',
    schemaVersion: 1,
    text: '明天上午 10 点有产品评审，11:30 和 Bob 的 1:1 🙂',
  },
  mentions: [],
  replyTo: null,
  aiMeta: {
    taskId: 't_00000000-0000-4000-8000-000000000001',
    mode: 'auto',
    toolsUsed: ['calendar.read'],
    risk: 'L0',
    confidence: 0.92,
    hopCount: 0,
    explanation: {
      decision: 'reply',
      reason: '对方询问日程，属于只读问答，命中自动档允许范围',
      confidence: 0.92,
      toolsUsed: ['calendar.read'],
      memoriesUsed: [],
    },
  },
  recalled: false,
  createdAt: '2026-11-11T02:00:01.500Z',
};

/** 草稿卡片消息 */
export const fixtureDraftCardMessage: Message = {
  msgId: 'm_00000000-0000-4000-8000-000000000003',
  convId: 'c_00000000-0000-4000-8000-000000000010',
  seq: 7,
  clientMsgId: null,
  senderId: 'a_00000000-0000-4000-8000-000000000001',
  senderType: 'avatar',
  onBehalfOf: 'u_00000000-0000-4000-8000-000000000001',
  content: {
    type: 'card',
    schemaVersion: 1,
    card: {
      kind: 'draft',
      taskId: 't_00000000-0000-4000-8000-000000000002',
      draftText: '好的，明天上午我把报价发你。',
      reason: '对方追问报价，属于商务承诺范畴，建议由主人确认后发送',
      targetConvId: 'c_00000000-0000-4000-8000-000000000001',
      replyToMsgId: null,
      expiresAt: '2026-11-11T03:00:00.000Z',
    },
  },
  mentions: [],
  replyTo: null,
  aiMeta: null,
  recalled: false,
  createdAt: '2026-11-11T02:05:00.000Z',
};

/** 确认卡片消息 */
export const fixtureApprovalCardMessage: Message = {
  msgId: 'm_00000000-0000-4000-8000-000000000004',
  convId: 'c_00000000-0000-4000-8000-000000000010',
  seq: 8,
  clientMsgId: null,
  senderId: 'a_00000000-0000-4000-8000-000000000001',
  senderType: 'avatar',
  onBehalfOf: 'u_00000000-0000-4000-8000-000000000001',
  content: {
    type: 'card',
    schemaVersion: 1,
    card: {
      kind: 'approval',
      approvalId: 'ap_00000000-0000-4000-8000-000000000001',
      taskId: 't_00000000-0000-4000-8000-000000000003',
      title: '向对方发送 500 元转账',
      summary: '对方请求借款 500 元。该操作为 L2 高风险（对外资金），需要你确认后执行。',
      toolName: 'payment.send',
      args: { amount: 500, currency: 'CNY', to: 'u_00000000-0000-4000-8000-000000000002' },
      risk: 'L2',
      expiresAt: '2026-11-11T04:00:00.000Z',
    },
  },
  mentions: [],
  replyTo: null,
  aiMeta: null,
  recalled: false,
  createdAt: '2026-11-11T02:10:00.000Z',
};

export const fixtureTaskCardMessage: Message = {
  msgId: 'm_00000000-0000-4000-8000-000000000005',
  convId: 'c_00000000-0000-4000-8000-000000000010',
  seq: 9,
  clientMsgId: null,
  senderId: 'a_00000000-0000-4000-8000-000000000001',
  senderType: 'avatar',
  onBehalfOf: 'u_00000000-0000-4000-8000-000000000001',
  content: {
    type: 'card',
    schemaVersion: 1,
    card: {
      kind: 'task',
      taskId: 't_00000000-0000-4000-8000-000000000003',
      title: '整理本周会议纪要',
      status: 'running',
      steps: [
        { name: '检索日历', status: 'done', detail: '找到 3 场会议' },
        { name: '生成纪要', status: 'running' },
      ],
    },
  },
  mentions: [],
  replyTo: null,
  aiMeta: null,
  recalled: false,
  createdAt: '2026-11-11T02:15:00.000Z',
};

export const fixtureClientFrames: ClientFrame[] = [
  {
    type: 'auth',
    token: 'tok_demo',
    platform: 'web',
    deviceId: fixtureDeviceRegistration.deviceId,
    appVersion: fixtureDeviceRegistration.appVersion,
    capabilities: fixtureDeviceCapabilities,
  },
  { type: 'heartbeat', ts: 1762833600000 },
  {
    type: 'send_message',
    clientMsgId: 'cm_00000000-0000-4000-8000-000000000001',
    convId: 'c_00000000-0000-4000-8000-000000000001',
    content: {
      type: 'text',
      schemaVersion: 1,
      text: '@a_00000000-0000-4000-8000-000000000001 帮我查下日程',
    },
    mentions: ['a_00000000-0000-4000-8000-000000000001'],
    replyTo: null,
  },
  { type: 'typing', convId: 'c_00000000-0000-4000-8000-000000000001' },
  { type: 'mark_read', convId: 'c_00000000-0000-4000-8000-000000000001', seq: 42 },
  { type: 'recall_message', msgId: 'm_00000000-0000-4000-8000-000000000001' },
  {
    type: 'pull_messages',
    convId: 'c_00000000-0000-4000-8000-000000000001',
    fromSeq: 30,
    limit: 50,
  },
];

export const fixtureServerFrames: ServerFrame[] = [
  {
    type: 'auth_ok',
    user: fixtureUser,
    serverTime: '2026-11-11T02:00:00.000Z',
    serverEpoch: 'epoch_demo_001',
  },
  { type: 'heartbeat_ack', ts: 1762833600000 },
  { type: 'message_created', message: fixtureHumanMessage },
  {
    type: 'message_acked',
    clientMsgId: 'cm_00000000-0000-4000-8000-000000000001',
    msgId: 'm_00000000-0000-4000-8000-000000000001',
    seq: 43,
    serverTime: '2026-11-11T02:00:00.000Z',
  },
  {
    type: 'message_recalled',
    convId: 'c_00000000-0000-4000-8000-000000000001',
    msgId: 'm_00000000-0000-4000-8000-000000000001',
  },
  { type: 'message_updated', message: fixtureTaskCardMessage },
  {
    type: 'messages_batch',
    convId: 'c_00000000-0000-4000-8000-000000000001',
    messages: [fixtureHumanMessage, fixtureAvatarMessage],
    hasMore: false,
  },
  {
    type: 'typing',
    convId: 'c_00000000-0000-4000-8000-000000000001',
    principalId: 'u_00000000-0000-4000-8000-000000000002',
    untilTs: 1762833660000,
  },
  { type: 'presence', principalId: 'u_00000000-0000-4000-8000-000000000002', online: true },
  {
    type: 'read_sync',
    convId: 'c_00000000-0000-4000-8000-000000000001',
    principalId: 'u_00000000-0000-4000-8000-000000000002',
    lastReadSeq: 41,
  },
  { type: 'conversations_changed' },
  { type: 'error', code: 'forbidden', message: '无权操作该会话' },
];

export const fixturePolicy: Policy = {
  id: 'p_00000000-0000-4000-8000-000000000001',
  ownerId: 'u_00000000-0000-4000-8000-000000000001',
  scopeType: 'contact',
  scopeId: 'u_00000000-0000-4000-8000-000000000002',
  name: '对家人自动档',
  rule: {
    mode: 'auto',
    schedule: [{ days: [1, 2, 3, 4, 5], start: '19:00', end: '23:00' }],
    allowCapabilities: ['calendar.read', 'reply.text'],
    denyTopics: ['money', 'health'],
    maxRisk: 'L1',
    rateLimitPerHour: 20,
    escalateWhen: ['confidence<0.7'],
  },
  priority: 10,
  enabled: true,
  version: 1,
  createdAt: '2026-11-01T08:00:00.000Z',
  updatedAt: '2026-11-01T08:00:00.000Z',
};

export const fixtureAgentTask: AgentTask = {
  id: 't_00000000-0000-4000-8000-000000000001',
  avatarId: 'a_00000000-0000-4000-8000-000000000001',
  ownerId: 'u_00000000-0000-4000-8000-000000000001',
  triggerMsgId: 'm_00000000-0000-4000-8000-000000000001',
  triggerConvId: 'c_00000000-0000-4000-8000-000000000001',
  triggerKind: 'auto',
  status: 'completed',
  result: '明天上午 10 点有产品评审',
  decision: { action: 'reply', reason: '日程询问，只读问答', confidence: 0.92 },
  costUsd: 0.0004,
  tokensUsed: 850,
  traceId: 'trace_demo_001',
  error: null,
  createdAt: '2026-11-11T02:00:00.100Z',
  updatedAt: '2026-11-11T02:00:01.500Z',
};

export const fixtureApproval: Approval = {
  id: 'ap_00000000-0000-4000-8000-000000000001',
  taskId: 't_00000000-0000-4000-8000-000000000003',
  avatarId: 'a_00000000-0000-4000-8000-000000000001',
  approver: 'u_00000000-0000-4000-8000-000000000001',
  title: '向对方发送 500 元转账',
  toolName: 'payment.send',
  args: { amount: 500 },
  status: 'pending',
  cardMsgId: 'm_00000000-0000-4000-8000-000000000004',
  expiresAt: '2026-11-11T04:00:00.000Z',
  resolvedAt: null,
  createdAt: '2026-11-11T02:10:00.000Z',
};

export const fixtureMemory: MemoryItem = {
  id: 'mem_00000000-0000-4000-8000-000000000001',
  avatarId: 'a_00000000-0000-4000-8000-000000000001',
  scope: 'contact',
  peerId: 'u_00000000-0000-4000-8000-000000000002',
  type: 'commitment',
  content: '周四答应给对方发报价单',
  keywords: ['报价', '周四'],
  sensitivity: 'normal',
  confidence: 0.85,
  sourceMsgId: 'm_00000000-0000-4000-8000-000000000001',
  expiresAt: null,
  createdAt: '2026-11-10T09:00:00.000Z',
};

export const fixtureDailyReport: DailyReport = {
  id: 'r_00000000-0000-4000-8000-000000000001',
  avatarId: 'a_00000000-0000-4000-8000-000000000001',
  day: '2026-11-10',
  summary: '今天我替你回复了 12 条消息，完成了 2 个任务；有 1 项转账请求等你确认。',
  stats: {
    repliedCount: 12,
    tasksCompleted: 2,
    draftsSent: 3,
    draftsDiscarded: 1,
    handovers: 1,
    approvalsPending: 1,
    acceptedRate: 0.75,
    costUsd: 0.021,
  },
  pendingDecisions: [{ kind: 'approval', title: '向对方发送 500 元转账', detail: '等待确认' }],
  cardMsgId: 'm_00000000-0000-4000-8000-000000000006',
  createdAt: '2026-11-11T00:10:00.000Z',
};

/** 全部 fixtures 的注册表（export:fixtures 与双侧契约测试遍历用） */
export const fixtures = {
  user: fixtureUser,
  avatar: fixtureAvatar,
  principal: fixturePrincipal,
  conversation: fixtureConversation,
  member: fixtureMember,
  deviceCapabilities: fixtureDeviceCapabilities,
  deviceRegistration: fixtureDeviceRegistration,
  humanMessage: fixtureHumanMessage,
  avatarMessage: fixtureAvatarMessage,
  draftCardMessage: fixtureDraftCardMessage,
  approvalCardMessage: fixtureApprovalCardMessage,
  taskCardMessage: fixtureTaskCardMessage,
  clientFrames: fixtureClientFrames,
  serverFrames: fixtureServerFrames,
  policy: fixturePolicy,
  agentTask: fixtureAgentTask,
  approval: fixtureApproval,
  memory: fixtureMemory,
  dailyReport: fixtureDailyReport,
} as const;
export type Fixtures = typeof fixtures;
