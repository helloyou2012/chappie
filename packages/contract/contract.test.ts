import { describe, expect, test } from 'bun:test';
import {
  AgentTask,
  Approval,
  Avatar,
  ClientFrame,
  Conversation,
  ConversationView,
  DailyReport,
  DeviceCapabilities,
  DeviceRegistration,
  fixtures,
  Member,
  MemoryItem,
  Message,
  Policy,
  Principal,
  ServerFrame,
  User,
} from './src/index';

describe('契约 fixtures 全部通过 zod 校验（与 Rust 侧共用同一数据源）', () => {
  test('identity', () => {
    expect(User.parse(fixtures.user)).toBeTruthy();
    expect(Avatar.parse(fixtures.avatar)).toBeTruthy();
    expect(Principal.parse(fixtures.principal)).toBeTruthy();
  });

  test('chat', () => {
    expect(Conversation.parse(fixtures.conversation)).toBeTruthy();
    expect(Member.parse(fixtures.member)).toBeTruthy();
    for (const key of [
      'humanMessage',
      'avatarMessage',
      'draftCardMessage',
      'approvalCardMessage',
      'taskCardMessage',
    ] as const) {
      const parsed = Message.safeParse(fixtures[key]);
      expect(parsed.success).toBe(true);
    }
  });

  test('device', () => {
    expect(DeviceCapabilities.parse(fixtures.deviceCapabilities)).toBeTruthy();
    expect(DeviceRegistration.parse(fixtures.deviceRegistration)).toBeTruthy();
  });

  test('frames', () => {
    for (const f of fixtures.clientFrames) {
      expect(ClientFrame.safeParse(f).success).toBe(true);
    }
    for (const f of fixtures.serverFrames) {
      expect(ServerFrame.safeParse(f).success).toBe(true);
    }
  });

  test('ai', () => {
    expect(Policy.parse(fixtures.policy)).toBeTruthy();
    expect(AgentTask.parse(fixtures.agentTask)).toBeTruthy();
    expect(Approval.parse(fixtures.approval)).toBeTruthy();
    expect(MemoryItem.parse(fixtures.memory)).toBeTruthy();
    expect(DailyReport.parse(fixtures.dailyReport)).toBeTruthy();
  });

  test('ConversationView 可组合', () => {
    const view = {
      conversation: fixtures.conversation,
      myPrincipalId: fixtures.user.id,
      myRole: 'member',
      myAiMode: 'auto',
      myAiModeUntil: null,
      myLastReadSeq: 40,
      unreadCount: 2,
      displayTitle: 'Bob',
      lastMsgPreview: '明天上午 10 点有产品评审',
      lastMsgAt: '2026-11-11T02:00:01.500Z',
      lastMsgSenderId: fixtures.avatar.id,
    } as const;
    expect(ConversationView.parse(view)).toBeTruthy();
  });

  test('未知 content.type 的降级路径（客户端 safeParse 失败 → 显示占位文本）', () => {
    const unknown = { type: 'vote', schemaVersion: 1, options: [] } as never;
    expect(Message.safeParse({ ...fixtures.humanMessage, content: unknown }).success).toBe(false);
  });
});
