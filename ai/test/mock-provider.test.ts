/** Mock 模型网关行为（默认演示 provider，无外部依赖）—— 设计方案 §27.8。 */
import { describe, expect, test } from 'bun:test';
import { mockProvider } from '../src/model-gateway/mock';
import type { CompleteRequest, ToolDef } from '../src/model-gateway/types';

const ALL_TOOLS: ToolDef[] = [
  'calendar.read',
  'calendar.create',
  'todo.list',
  'todo.add',
  'translate',
  'summarize',
  'web.search',
  'payment.send',
].map((name) => ({ name, description: name, parameters: {} }));

function req(text: string, opts: Partial<CompleteRequest> = {}): CompleteRequest {
  return {
    system: '你是 alice 的 AI 分身。',
    messages: [{ role: 'user', content: text }],
    tools: ALL_TOOLS,
    mockHints: { ownerName: 'alice', triggerText: text },
    ...opts,
  };
}

describe('mockProvider 文本回复', () => {
  test('问候语包含主人名字且不发起工具调用', async () => {
    const r = await mockProvider.complete(req('你好'), { model: 'x', baseUrl: '', apiKey: '' });
    expect(r.toolCalls).toEqual([]);
    expect(r.text).toContain('alice');
    expect(r.provider).toBe('mock');
  });

  test('疑问句 → 提问模板，置信度可用', async () => {
    const r = await mockProvider.complete(req('这个方案怎么样？'), {
      model: 'x',
      baseUrl: '',
      apiKey: '',
    });
    expect(r.toolCalls).toEqual([]);
    expect(r.confidence).toBeGreaterThan(0.7);
    expect(r.text.length).toBeGreaterThan(0);
  });

  test('商务报价 → 低置信度（触发 auto 档转草稿/转交）', async () => {
    const r = await mockProvider.complete(req('这个报价多少钱'), {
      model: 'x',
      baseUrl: '',
      apiKey: '',
    });
    expect(r.confidence).toBeLessThan(0.7);
  });

  test('法律事务 → handover', async () => {
    const r = await mockProvider.complete(req('帮忙看下这个合同怎么写'), {
      model: 'x',
      baseUrl: '',
      apiKey: '',
    });
    expect(r.handover).toBeTruthy();
  });
});

describe('mockProvider 工具触发', () => {
  test('日程查询 → calendar.read', async () => {
    const r = await mockProvider.complete(req('帮我查一下今天的日程'), {
      model: 'x',
      baseUrl: '',
      apiKey: '',
    });
    expect(r.toolCalls[0]?.name).toBe('calendar.read');
    expect(r.toolCalls[0]?.args).toEqual({ day: 'today' });
  });

  test('未授权工具不触发（tools 未下发）→ 普通文本', async () => {
    const r = await mockProvider.complete(req('帮我查一下今天的日程', { tools: [] }), {
      model: 'x',
      baseUrl: '',
      apiKey: '',
    });
    expect(r.toolCalls).toEqual([]);
    expect(r.text.length).toBeGreaterThan(0);
  });

  test('转账 → payment.send 且金额从文本解析', async () => {
    const r = await mockProvider.complete(req('帮我给 bob 转账 300 元'), {
      model: 'x',
      baseUrl: '',
      apiKey: '',
    });
    expect(r.toolCalls[0]?.name).toBe('payment.send');
    expect(r.toolCalls[0]?.args.amount).toBe(300);
  });

  test('添加待办 → todo.add 且剥离指令前缀', async () => {
    const r = await mockProvider.complete(req('加个待办：买咖啡'), {
      model: 'x',
      baseUrl: '',
      apiKey: '',
    });
    const call = r.toolCalls[0];
    expect(call?.name).toBe('todo.add');
    expect(String(call?.args.text)).toContain('买咖啡');
  });

  test('工具结果回填 → 第二轮生成文本总结，不再发起工具调用', async () => {
    const r = await mockProvider.complete(
      {
        system: '你是 alice 的 AI 分身。',
        messages: [
          { role: 'user', content: '帮我查一下今天的日程' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'c1', name: 'calendar.read', args: { day: 'today' } }],
          },
          {
            role: 'tool',
            toolCallId: 'c1',
            content: JSON.stringify({ summary: '今天有 2 项安排：10:00 评审；11:30 1:1' }),
          },
        ],
        tools: ALL_TOOLS,
        mockHints: { ownerName: 'alice', triggerText: '帮我查一下今天的日程' },
      },
      { model: 'x', baseUrl: '', apiKey: '' },
    );
    expect(r.toolCalls).toEqual([]);
    expect(r.text).toContain('今天有 2 项安排');
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

describe('mockProvider 审批续跑', () => {
  test('系统事件续跑 → 直接总结已执行结果，不再调用工具', async () => {
    const r = await mockProvider.complete(
      {
        system: '你是 alice 的 AI 分身。',
        messages: [
          {
            role: 'user',
            content:
              '【系统事件】你此前请求的工具「payment.send」已获主人批准并执行完成。\n' +
              '执行结果：{"ok":true,"summary":"已代你向对方转账 ¥300"}\n' +
              '请基于该结果，给 bob 一个自然、简洁的回复。',
          },
        ],
        tools: ALL_TOOLS,
        mockHints: { ownerName: 'alice' },
      },
      { model: 'x', baseUrl: '', apiKey: '' },
    );
    expect(r.toolCalls).toEqual([]);
    expect(r.text).toContain('转账');
    expect(r.confidence).toBe(0.95);
  });
});
