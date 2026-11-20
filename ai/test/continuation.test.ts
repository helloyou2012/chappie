/**
 * 长程任务续驱 —— 纯函数部分：
 *   evaluateContinuationGuard：时限 / 段数 / 日预算护栏判定
 *   buildTaskCardSteps：进度卡片步骤构建（连续同名合并、截尾、进行中步骤）
 */
import { describe, expect, test } from 'bun:test';
import {
  buildTaskCardSteps,
  compactCheckpointMessages,
  summarizeDroppedMessages,
} from '../src/agent-runtime';
import { evaluateContinuationGuard } from '../src/continuation';

const LIMITS = { maxAgeMs: 1800_000, maxSegments: 20 };

describe('evaluateContinuationGuard 长任务护栏', () => {
  test('时限 / 段数 / 预算内 → 允许续跑', () => {
    expect(
      evaluateContinuationGuard(
        { ageMs: 600_000, segmentCount: 3, costUsd: 0.2, budgetUsd: 1.0 },
        LIMITS,
      ),
    ).toEqual({ ok: true });
  });

  test('超出整体时限 → 停止续跑', () => {
    const r = evaluateContinuationGuard(
      { ageMs: 1801_000, segmentCount: 3, costUsd: 0.2, budgetUsd: 1.0 },
      LIMITS,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('整体时限');
  });

  test('达到最大段数 → 停止续跑', () => {
    const r = evaluateContinuationGuard(
      { ageMs: 600_000, segmentCount: 20, costUsd: 0.2, budgetUsd: 1.0 },
      LIMITS,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('最大执行段数');
  });

  test('日预算用完 → 停止续跑', () => {
    const r = evaluateContinuationGuard(
      { ageMs: 600_000, segmentCount: 3, costUsd: 1.0, budgetUsd: 1.0 },
      LIMITS,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('日预算');
  });

  test('预算为 0 = 不设预算限制，不因预算停止', () => {
    expect(
      evaluateContinuationGuard(
        { ageMs: 600_000, segmentCount: 3, costUsd: 99, budgetUsd: 0 },
        LIMITS,
      ),
    ).toEqual({ ok: true });
  });

  test('边界值：恰好等于时限 / 段数 / 预算不触发（严格大于才停）', () => {
    expect(
      evaluateContinuationGuard(
        { ageMs: 1800_000, segmentCount: 19, costUsd: 0.999, budgetUsd: 1.0 },
        LIMITS,
      ),
    ).toEqual({ ok: true });
  });
});

describe('buildTaskCardSteps 进度卡片步骤', () => {
  test('连续同名工具合并为 ×N', () => {
    const steps = buildTaskCardSteps(['calendar.read', 'calendar.read', 'todo.add']);
    expect(steps).toHaveLength(3); // 2 组 done + 1 个「继续处理中」
    expect(steps[0]?.name).toBe('查询日程');
    expect(steps[0]?.detail).toBe('执行 2 次');
    expect(steps[1]?.name).toBe('添加待办');
    expect(steps[2]?.status).toBe('running');
  });

  test('只保留最近 8 组，更早的丢弃', () => {
    const toolsUsed = Array.from({ length: 12 }, (_, i) => `tool_${i % 3 === 0 ? 'a' : 'b'}_${i}`);
    // 构造 12 个互不相同的 id → 12 组，截尾留 8 组 + 1 进行中
    const steps = buildTaskCardSteps(toolsUsed);
    expect(steps).toHaveLength(9);
  });

  test('空工具序列 → 至少有「分析任务」与进行中步骤', () => {
    const steps = buildTaskCardSteps([]);
    expect(steps[0]?.name).toBe('分析任务');
    expect(steps[steps.length - 1]?.status).toBe('running');
  });

  test('未知工具 id 原样展示', () => {
    const steps = buildTaskCardSteps(['mcp.unknown_tool']);
    expect(steps[0]?.name).toBe('mcp.unknown_tool');
  });
});

describe('compactCheckpointMessages 检查点压缩', () => {
  type Msg = {
    role: 'user' | 'assistant' | 'tool';
    content: string;
    toolCallId?: string;
    toolCalls?: { id: string; name: string; args: Record<string, unknown> }[];
  };

  function longConversation(rounds: number): Msg[] {
    const messages: Msg[] = [{ role: 'user', content: '帮我完成一个很长的任务' }];
    for (let i = 0; i < rounds; i++) {
      messages.push({
        role: 'assistant',
        content: '',
        toolCalls: [{ id: `c${i}`, name: 'calendar.read', args: { day: 'today' } }],
      });
      messages.push({
        role: 'tool',
        toolCallId: `c${i}`,
        content: JSON.stringify({ summary: `第 ${i} 步的日程结果` }),
      });
    }
    return messages;
  }

  test('消息未超阈值 → 原样返回', () => {
    const messages = longConversation(3);
    expect(compactCheckpointMessages(messages as never)).toBe(messages as never);
  });

  test('超阈值 → 保留首条 + 折叠摘要 + 最近的成对消息', () => {
    const messages = longConversation(20); // 41 条
    const compacted = compactCheckpointMessages(messages as never);
    expect(compacted.length).toBeLessThan(messages.length);
    expect(compacted[0]?.content).toContain('很长的任务');
    // 第二条是折叠摘要（较早步骤）
    expect(compacted[1]?.content).toContain('此前已完成步骤摘要');
    expect(compacted[1]?.content).toContain('calendar.read');
    // 截断点不能以悬空 tool 结果开头（避免 provider 拒绝不成对的 tool_result）
    expect(compacted[2]?.role).not.toBe('tool');
  });

  test('摘要包含工具结果的可读内容', () => {
    const summary = summarizeDroppedMessages([
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'todo.add', args: {} }],
      },
      {
        role: 'tool',
        toolCallId: 'c1',
        content: JSON.stringify({ summary: '已加入待办：买咖啡' }),
      },
    ]);
    expect(summary).toContain('todo.add');
    expect(summary).toContain('已加入待办：买咖啡');
  });

  test('非 JSON 工具输出按原文截断纳入摘要', () => {
    const summary = summarizeDroppedMessages([
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'web.search', args: {} }],
      },
      { role: 'tool', toolCallId: 'c1', content: 'plain text result' },
    ]);
    expect(summary).toContain('plain text result');
  });
});
