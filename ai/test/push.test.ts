/**
 * 推送与日程提醒测试（纯函数部分）。
 */

import { describe, expect, test } from 'bun:test';
import { previewOfCard } from '../src/common/push';
import { reminderWindow } from '../src/scheduler';

describe('previewOfCard：卡片 → 推送文案', () => {
  test('approval 卡片生成推送', () => {
    const m = previewOfCard({
      kind: 'approval',
      approvalId: 'ap_1',
      taskId: 't_1',
      title: '请求执行：发起转账',
      summary: '分身准备执行「发起转账」（L2）。',
      toolName: 'payment.send',
      args: { amount: 100 },
      risk: 'L2',
      expiresAt: null,
    });
    expect(m).not.toBeNull();
    expect(m?.title).toContain('转账');
    expect(m?.data?.kind).toBe('approval');
  });

  test('handover / calendar_reminder / report 生成推送', () => {
    expect(
      previewOfCard({ kind: 'handover', taskId: 't_1', summary: '请人工复核', reason: '' }),
    ).not.toBeNull();
    const reminder = previewOfCard({
      kind: 'calendar_reminder',
      entryId: 'cal_1',
      title: '评审会',
      startAt: '2026-11-18T02:00:00.000Z',
      summary: '10 分钟后开始',
    });
    expect(reminder).not.toBeNull();
    expect(reminder?.title.startsWith('日程提醒')).toBe(true);
    expect(
      previewOfCard({ kind: 'report', reportId: 'r_1', day: '2026-11-18', summary: '今天…' }),
    ).not.toBeNull();
  });

  test('draft / task 卡片不推送（主人在线时高频，避免骚扰）', () => {
    expect(
      previewOfCard({
        kind: 'draft',
        taskId: 't_1',
        draftText: '好的',
        reason: '',
        targetConvId: 'c_1',
        replyToMsgId: null,
        expiresAt: null,
      }),
    ).toBeNull();
    expect(
      previewOfCard({
        kind: 'task',
        taskId: 't_1',
        title: '整理纪要',
        status: 'running',
        steps: [],
        summary: '',
      }),
    ).toBeNull();
  });
});

describe('reminderWindow：提醒时机判定', () => {
  const now = new Date('2026-11-18T03:00:00Z');

  test('开始前 11 分钟以上：等待', () => {
    const start = new Date('2026-11-18T03:21:00Z');
    expect(reminderWindow(start, now)).toBe('wait');
  });

  test('进入提前量窗口（前 10 分钟内）：触发', () => {
    const start = new Date('2026-11-18T03:05:00Z');
    expect(reminderWindow(start, now)).toBe('fire');
  });

  test('已开始但在宽限期内：触发（补发）', () => {
    const start = new Date('2026-11-18T02:56:00Z');
    expect(reminderWindow(start, now)).toBe('fire');
  });

  test('超过时效线（开始后 15 分钟以上）：missed，不打扰', () => {
    const start = new Date('2026-11-18T02:40:00Z');
    expect(reminderWindow(start, now)).toBe('missed');
  });
});
