/**
 * REST API 客户端（Web / Desktop / RN 共用）。
 * im-core :7000 /api/v1 与 ai-platform :7002 /admin/v1。
 */

import type {
  AddContactRequest,
  AddContactResponse,
  AddMembersRequest,
  AddMembersResponse,
  Avatar,
  CardActionRequest,
  CreateCalendarItemRequest,
  CreateCalendarItemResponse,
  CreateConversationResponse,
  CreateTodoItemRequest,
  CreateTodoItemResponse,
  DailyReport,
  DelegationView,
  DeviceCapabilities,
  FeedbackType,
  FriendRequestActionResponse,
  GetCalendarResponse,
  GetReceptionResponse,
  GetTaskResponse,
  GetTodoResponse,
  ListApprovalsResponse,
  ListCapabilitiesResponse,
  ListContactsResponse,
  ListConversationsResponse,
  ListDelegationsResponse,
  ListDevicesResponse,
  ListFriendRequestsResponse,
  ListMembersResponse,
  ListMemoriesResponse,
  ListMessagesResponse,
  ListPoliciesResponse,
  ListTasksResponse,
  MeResponse,
  Policy,
  PolicyRule,
  PreviewResponse,
  ReceptionStrategy,
  ReceptionView,
  RemoveMemberResponse,
  RequestHumanResponse,
  SendCodeResponse,
  SendFriendRequestResponse,
  TransferOwnerResponse,
  UpdateCalendarItemRequest,
  UpdateCalendarItemResponse,
  UpdateContactRequest,
  UpdateContactResponse,
  UpdateProfileRequest,
  UpdateReceptionRequest,
  UpdateTodoItemRequest,
  UsageDay,
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

export interface FileInfo {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
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

/** 附件 URL：服务端返回相对签名路径，客户端按 adminUrl 解析；绝对 URL 原样返回 */
export function resolveAttachmentUrl(url: string): string {
  if (!url) return '';
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  const root = config.adminUrl.replace(/\/$/, '');
  return `${root}${url.startsWith('/') ? url : `/${url}`}`;
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
  updateProfile: (req: UpdateProfileRequest) => s<MeResponse>('PATCH', '/api/v1/me', req),

  // 联系人
  listContacts: () => s<ListContactsResponse>('GET', '/api/v1/contacts'),
  addContact: (req: AddContactRequest) => s<AddContactResponse>('POST', '/api/v1/contacts', req),
  updateContact: (peerId: string, req: UpdateContactRequest) =>
    s<UpdateContactResponse>('PATCH', `/api/v1/contacts/${peerId}`, req),
  removeContact: (peerId: string) => s<{ ok: boolean }>('DELETE', `/api/v1/contacts/${peerId}`),

  // 好友申请
  sendFriendRequest: (req: { email: string; message?: string }) =>
    s<SendFriendRequestResponse>('POST', '/api/v1/friend-requests', req),
  listFriendRequests: () => s<ListFriendRequestsResponse>('GET', '/api/v1/friend-requests'),
  acceptFriendRequest: (id: string) =>
    s<FriendRequestActionResponse>('POST', `/api/v1/friend-requests/${id}/accept`),
  rejectFriendRequest: (id: string) =>
    s<FriendRequestActionResponse>('POST', `/api/v1/friend-requests/${id}/reject`),
  cancelFriendRequest: (id: string) =>
    s<FriendRequestActionResponse>('POST', `/api/v1/friend-requests/${id}/cancel`),

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
  addMembers: (convId: string, req: AddMembersRequest) =>
    s<AddMembersResponse>('POST', `/api/v1/conversations/${convId}/members`, req),
  removeMember: (convId: string, principalId: string) =>
    s<RemoveMemberResponse>('DELETE', `/api/v1/conversations/${convId}/members/${principalId}`),
  transferOwner: (convId: string, targetUserId: string) =>
    s<TransferOwnerResponse>('POST', `/api/v1/conversations/${convId}/transfer-owner`, {
      targetUserId,
    }),
  dissolveGroup: (convId: string) =>
    s<{ ok: boolean }>('DELETE', `/api/v1/conversations/${convId}`),
  updateSettings: (convId: string, req: { aiMode?: string; tempHours?: number }) =>
    s<{ ok: boolean }>('PATCH', `/api/v1/conversations/${convId}/settings`, req),
  takeover: (convId: string) =>
    s<{ ok: boolean; reception?: ReceptionView }>(
      'POST',
      `/api/v1/conversations/${convId}/takeover`,
    ),
  release: (convId: string) =>
    s<{ ok: boolean; reception?: ReceptionView }>(
      'POST',
      `/api/v1/conversations/${convId}/release`,
    ),
  getReception: (convId: string) =>
    s<GetReceptionResponse>('GET', `/api/v1/conversations/${convId}/reception`),
  updateReception: (convId: string, req: UpdateReceptionRequest) =>
    s<{ reception: ReceptionView }>('PUT', `/api/v1/conversations/${convId}/reception`, req),
  requestHuman: (convId: string, reason?: string) =>
    s<RequestHumanResponse>('POST', `/api/v1/conversations/${convId}/request-human`, { reason }),
  listDelegations: () => s<ListDelegationsResponse>('GET', '/api/v1/reception/delegations'),
  upsertDelegation: (req: {
    scopeType: 'global' | 'contact_group' | 'contact' | 'conversation';
    scopeId?: string | null;
    state: string;
    strategy: ReceptionStrategy;
    schedule?: { days: number[]; start: string; end: string }[];
    timezone?: string;
    expiresAt?: string | null;
  }) => s<{ delegation: DelegationView }>('POST', '/api/v1/reception/delegations', req),
  revokeDelegation: (id: string) =>
    s<{ ok: boolean }>('DELETE', `/api/v1/reception/delegations/${id}`),
  cardAction: (msgId: string, req: CardActionRequest) =>
    s<{ ok: boolean }>('POST', `/api/v1/cards/${msgId}/action`, req),
  feedback: (msgId: string, req: { type: FeedbackType; correctedText?: string; reason?: string }) =>
    s<{ ok: boolean }>('POST', `/api/v1/messages/${msgId}/feedback`, req),
  listDevices: () => s<ListDevicesResponse>('GET', '/api/v1/devices'),
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
  updateAvatar: (req: { persona?: string; dailyBudgetUsd?: number; trustLevel?: number }) =>
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
  createCalendarItem: (req: CreateCalendarItemRequest) =>
    a<CreateCalendarItemResponse>('POST', '/admin/v1/calendar', req),
  updateCalendarItem: (index: number, req: UpdateCalendarItemRequest) =>
    a<UpdateCalendarItemResponse>('PATCH', `/admin/v1/calendar/${index}`, req),
  deleteCalendarItem: (index: number) =>
    a<{ ok: boolean }>('DELETE', `/admin/v1/calendar/${index}`),
  listTodo: () => a<GetTodoResponse>('GET', '/admin/v1/todo'),
  createTodoItem: (req: CreateTodoItemRequest) =>
    a<CreateTodoItemResponse>('POST', '/admin/v1/todo', req),
  updateTodoItem: (index: number, req: UpdateTodoItemRequest) =>
    a<{ ok: boolean }>('PATCH', `/admin/v1/todo/${index}`, req),
  deleteTodoItem: (index: number) => a<{ ok: boolean }>('DELETE', `/admin/v1/todo/${index}`),

  // 文件（头像控制台 / 聊天上传）
  listFiles: () => a<{ files: FileInfo[] }>('GET', '/admin/v1/files'),
  uploadFile: async (file: Blob | { uri: string; name?: string; type?: string }, name?: string) => {
    const form = new FormData();
    const displayName =
      name ?? (file as { name?: string }).name ?? (file as { uri?: string }).uri ?? 'file';
    form.append('file', file as unknown as Blob, displayName);
    const token = config.getToken();
    const res = await fetch(`${config.adminUrl}/admin/v1/files`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      let code = 'error';
      let message = res.statusText || `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        code = body.error?.code ?? code;
        message = body.error?.message ?? message;
      } catch {
        // 非 JSON 错误体
      }
      throw new ApiError(res.status, code, message);
    }
    return (await res.json()) as { file: FileInfo; url: string };
  },
  deleteFile: (id: string) => a<{ ok: boolean }>('DELETE', `/admin/v1/files/${id}`),
  downloadFile: async (id: string) => {
    const token = config.getToken();
    const res = await fetch(`${config.adminUrl}/admin/v1/files/${id}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new ApiError(res.status, 'download_failed', res.statusText);
    return res.blob();
  },

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
  ContactView,
  Content,
  Conversation,
  ConversationView,
  DailyReport,
  DelegationScheduleWindow,
  DelegationView,
  DeviceView,
  Explanation,
  FeedbackType,
  FriendRequestStatus,
  FriendRequestView,
  MemberView,
  MemoryItem,
  Message,
  Policy,
  PolicyRule,
  PolicyScopeType,
  ReceptionState,
  ReceptionStrategy,
  ReceptionView,
  RiskLevel,
  ScheduleWindow,
  StyleProfile,
  TaskStep,
  TodoItem,
  UsageDay,
  User,
} from '@chappie/contract';
