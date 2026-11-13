/**
 * REST API 客户端（Web / Desktop / RN 共用）。
 * im-core :7000 /api/v1 与 ai-platform :7002 /admin/v1。
 */

import type {
  Avatar,
  CardActionRequest,
  CreateConversationResponse,
  DailyReport,
  DeviceCapabilities,
  FeedbackType,
  GetCalendarResponse,
  GetTaskResponse,
  GetTodoResponse,
  ListApprovalsResponse,
  ListCapabilitiesResponse,
  ListConversationsResponse,
  ListMembersResponse,
  ListMemoriesResponse,
  ListMessagesResponse,
  ListPoliciesResponse,
  ListTasksResponse,
  MeResponse,
  Policy,
  PolicyRule,
  PreviewResponse,
  SendCodeResponse,
  UpdateTodoItemRequest,
  UsageDay,
  User,
  VerifyCodeResponse,
} from '@chappie/contract';
import { DEFAULT_ADMIN_URL, DEFAULT_SERVER_URL } from './constants';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** 分身初始化中（user.created 事件异步创建，客户端稍后重试） */
  get isAvatarNotReady(): boolean {
    return this.code === 'avatar_not_ready';
  }
}

export interface ApiConfig {
  serverUrl: string;
  adminUrl: string;
  getToken: () => string | null;
  onUnauthorized?: () => void;
}

let config: ApiConfig = {
  serverUrl: DEFAULT_SERVER_URL,
  adminUrl: DEFAULT_ADMIN_URL,
  getToken: () => null,
};

export function configureApi(partial: Partial<ApiConfig>): void {
  config = { ...config, ...partial };
}

export function getApiConfig(): Readonly<ApiConfig> {
  return config;
}

export function wsUrlFromServerUrl(serverUrl: string): string {
  return `${serverUrl.replace(/\/$/, '').replace(/^http/, 'ws')}/ws`;
}

async function request<T>(
  base: 'server' | 'admin',
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const root = base === 'server' ? config.serverUrl : config.adminUrl;
  const token = config.getToken();
  let res: Response;
  try {
    res = await fetch(`${root}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ApiError(0, 'network', `无法连接服务器（${root}）：${String(e)}`);
  }

  if (!res.ok) {
    let code = 'error';
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: { code?: string; message?: string } };
      code = data.error?.code ?? code;
      message = data.error?.message ?? message;
    } catch {
      /* keep defaults */
    }
    if (res.status === 401) config.onUnauthorized?.();
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const s = <T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
  request<T>('server', method, path, body);
const a = <T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
  request<T>('admin', method, path, body);

// ---------------------------------------------------------------------------
// im-core REST
// ---------------------------------------------------------------------------

export const api = {
  // 认证
  sendCode: (email: string) => s<SendCodeResponse>('POST', '/api/v1/auth/code/send', { email }),
  verifyCode: (email: string, code: string) =>
    s<VerifyCodeResponse>('POST', '/api/v1/auth/code/verify', { email, code }),
  logout: () => s<{ ok: boolean }>('POST', '/api/v1/auth/logout'),
  me: () => s<MeResponse>('GET', '/api/v1/me'),
  directory: () => s<{ users: User[] }>('GET', '/api/v1/directory'),

  // 会话
  listConversations: () => s<ListConversationsResponse>('GET', '/api/v1/conversations'),
  createConversation: (req: {
    type: 'direct' | 'group';
    memberUserIds: string[];
    title?: string;
  }) => s<CreateConversationResponse>('POST', '/api/v1/conversations', req),
  listMessages: (convId: string, opts?: { beforeSeq?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (opts?.beforeSeq) q.set('beforeSeq', String(opts.beforeSeq));
    if (opts?.limit) q.set('limit', String(opts.limit));
    const qs = q.toString();
    return s<ListMessagesResponse>(
      'GET',
      `/api/v1/conversations/${convId}/messages${qs ? `?${qs}` : ''}`,
    );
  },
  listMembers: (convId: string) =>
    s<ListMembersResponse>('GET', `/api/v1/conversations/${convId}/members`),
  updateSettings: (convId: string, req: { aiMode?: string; tempHours?: number }) =>
    s<{ ok: boolean }>('PATCH', `/api/v1/conversations/${convId}/settings`, req),
  takeover: (convId: string) =>
    s<{ ok: boolean }>('POST', `/api/v1/conversations/${convId}/takeover`),
  cardAction: (msgId: string, req: CardActionRequest) =>
    s<{ ok: boolean }>('POST', `/api/v1/cards/${msgId}/action`, req),
  feedback: (msgId: string, req: { type: FeedbackType; correctedText?: string; reason?: string }) =>
    s<{ ok: boolean }>('POST', `/api/v1/messages/${msgId}/feedback`, req),
  registerDevice: (req: {
    deviceId: string;
    platform: 'web' | 'desktop' | 'ios' | 'android';
    appVersion?: string;
    capabilities?: DeviceCapabilities;
    pushToken?: string;
  }) => s<{ ok: boolean }>('POST', '/api/v1/devices', req),
};

// ---------------------------------------------------------------------------
// ai-platform 控制台 API
// ---------------------------------------------------------------------------

export const adminApi = {
  getAvatar: () => a<{ avatar: Avatar; style: unknown | null }>('GET', '/admin/v1/avatar'),
  updateAvatar: (req: { name?: string; persona?: string; dailyBudgetUsd?: number }) =>
    a<{ avatar: Avatar }>('PATCH', '/admin/v1/avatar', req),
  preview: (text: string) => a<PreviewResponse>('POST', '/admin/v1/avatar/preview', { text }),
  freezeAvatar: (frozen: boolean) =>
    a<{ ok: boolean; frozen: boolean }>('POST', '/admin/v1/avatar/freeze', { frozen }),

  listPolicies: () => a<ListPoliciesResponse>('GET', '/admin/v1/policies'),
  createPolicy: (req: {
    scopeType: string;
    scopeId?: string | null;
    name?: string;
    rule: PolicyRule;
  }) => a<{ policy: Policy }>('POST', '/admin/v1/policies', req),
  updatePolicy: (id: string, req: { name?: string; rule?: PolicyRule; enabled?: boolean }) =>
    a<{ policy: Policy }>('PATCH', `/admin/v1/policies/${id}`, req),
  deletePolicy: (id: string) => a<{ ok: boolean }>('DELETE', `/admin/v1/policies/${id}`),

  listCapabilities: () => a<ListCapabilitiesResponse>('GET', '/admin/v1/capabilities'),
  updateGrant: (
    capabilityId: string,
    req: { granted: boolean; constraints?: Record<string, unknown> },
  ) => a<{ ok: boolean }>('PUT', `/admin/v1/capabilities/${capabilityId}/grant`, req),

  listMemories: (opts?: { scope?: 'all' | 'global' | 'contact'; peerId?: string }) => {
    const q = new URLSearchParams();
    if (opts?.scope) q.set('scope', opts.scope);
    if (opts?.peerId) q.set('peerId', opts.peerId);
    const qs = q.toString();
    return a<ListMemoriesResponse>('GET', `/admin/v1/memories${qs ? `?${qs}` : ''}`);
  },
  updateMemory: (id: string, req: { content?: string; sensitivity?: 'normal' | 'sensitive' }) =>
    a<{ ok: boolean }>('PATCH', `/admin/v1/memories/${id}`, req),
  deleteMemory: (id: string) => a<{ ok: boolean }>('DELETE', `/admin/v1/memories/${id}`),
  forgetTopic: (keyword: string) =>
    a<{ ok: boolean; deleted: number }>('POST', '/admin/v1/memories/forget-topic', { keyword }),

  listTasks: (opts?: { status?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (opts?.status) q.set('status', opts.status);
    if (opts?.limit) q.set('limit', String(opts.limit));
    const qs = q.toString();
    return a<ListTasksResponse>('GET', `/admin/v1/tasks${qs ? `?${qs}` : ''}`);
  },
  getTask: (id: string) => a<GetTaskResponse>('GET', `/admin/v1/tasks/${id}`),

  listApprovals: (opts?: { status?: string }) => {
    const q = new URLSearchParams();
    if (opts?.status) q.set('status', opts.status);
    const qs = q.toString();
    return a<ListApprovalsResponse>('GET', `/admin/v1/approvals${qs ? `?${qs}` : ''}`);
  },

  // 日程 / 待办（分身工具数据）
  listCalendar: () => a<GetCalendarResponse>('GET', '/admin/v1/calendar'),
  deleteCalendarItem: (index: number) =>
    a<{ ok: boolean }>('DELETE', `/admin/v1/calendar/${index}`),
  listTodo: () => a<GetTodoResponse>('GET', '/admin/v1/todo'),
  updateTodoItem: (index: number, req: UpdateTodoItemRequest) =>
    a<{ ok: boolean }>('PATCH', `/admin/v1/todo/${index}`, req),
  deleteTodoItem: (index: number) => a<{ ok: boolean }>('DELETE', `/admin/v1/todo/${index}`),

  getUsage: (days = 14) =>
    a<{ usage: UsageDay[]; todayCostUsd: number; dailyBudgetUsd: number }>(
      'GET',
      `/admin/v1/usage?days=${days}`,
    ),
  getDailyReport: (date?: string) =>
    a<{ report: DailyReport | null }>(
      'GET',
      `/admin/v1/reports/daily${date ? `?date=${date}` : ''}`,
    ),
  generateReport: () => a<{ report: DailyReport | null }>('POST', '/admin/v1/reports/generate'),
};

export type {
  AgentTask,
  Approval,
  Avatar,
  AvatarMode,
  CalendarItem,
  Capability,
  CapabilityGrant,
  CardAction,
  CardActionRequest,
  CardPayload,
  Content,
  Conversation,
  ConversationView,
  DailyReport,
  Explanation,
  FeedbackType,
  MemberView,
  MemoryItem,
  Message,
  Policy,
  PolicyRule,
  PolicyScopeType,
  RiskLevel,
  ScheduleWindow,
  StyleProfile,
  TaskStep,
  TodoItem,
  UsageDay,
  User,
} from '@chappie/contract';
