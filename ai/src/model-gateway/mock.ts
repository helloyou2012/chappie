/**
 * Mock provider —— 无需任何 API key 即可完整演示 AI 分身链路。
 *
 * 行为按规则模拟一个「有分寸的分身」：
 *   - 只读/低风险意图 → 发起对应工具调用（演示 ReAct 工具循环）
 *   - 资金 / 法律 → 直接建议转人工（handover）
 *   - 闲聊 / 问句 → 按人设口吻模板回复
 *   - 承诺 / 报价类 → 低置信度（触发 escalate 转交，演示「不确定即转人」）
 * 未配置真实模型时作为降级实现，接口与真实 provider 完全一致。
 */

import { v4 as uuidv4 } from 'uuid';
import { parseJsonSafe } from '../common/json';
import type { ChatMessage, CompleteRequest, CompleteResult, Provider, ToolCall } from './types';

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') return m.content;
  }
  return '';
}

function lastToolMessage(messages: ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'tool') return messages[i];
    if (messages[i].role === 'user') return undefined;
  }
  return undefined;
}

function quote(text: string, max = 24): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function ownerNameOf(req: CompleteRequest): string {
  const hint = req.mockHints?.ownerName;
  if (hint) return hint;
  // 从 system prompt 中提取「你是 XXX 的 AI 分身」
  const m = req.system.match(/你是\s*([^\s的，。]+)\s*的/);
  return m?.[1] ?? '主人';
}

function mockUsage(req: CompleteRequest): { inputTokens: number; outputTokens: number } {
  const inputChars = req.system.length + req.messages.reduce((n, m) => n + m.content.length, 0);
  return {
    inputTokens: Math.max(32, Math.ceil(inputChars / 2.2)),
    outputTokens: 64,
  };
}

function toolResult(
  tool: string,
  args: Record<string, unknown>,
  req: CompleteRequest,
  confidence = 0.92,
): CompleteResult {
  const call: ToolCall = { id: `call_${uuidv4()}`, name: tool, args };
  return {
    text: '',
    toolCalls: [call],
    usage: mockUsage(req),
    provider: 'mock',
    model: 'mock-1',
    costUsd: 0,
    confidence,
  };
}

function handover(reason: string, req: CompleteRequest): CompleteResult {
  return {
    text: '',
    toolCalls: [],
    usage: mockUsage(req),
    provider: 'mock',
    model: 'mock-1',
    costUsd: 0,
    handover: reason,
    confidence: 0.55,
  };
}

function textResult(text: string, req: CompleteRequest, confidence = 0.85): CompleteResult {
  return {
    text,
    toolCalls: [],
    usage: mockUsage(req),
    provider: 'mock',
    model: 'mock-1',
    costUsd: 0,
    confidence,
  };
}

function composeReply(userText: string, ownerName: string, intent: string): string {
  const q = quote(userText);
  if (intent === 'question') {
    const templates = [
      `我是 ${ownerName} 的 AI 分身～${ownerName} 现在可能不方便，先由我记下。关于「${q}」，我确认后第一时间回复你 🙂`,
      `收到你的问题「${q}」！${ownerName} 看到后会给准确答复，我先帮你把上下文留好。`,
      `这个问题我得跟 ${ownerName} 核对一下，避免说错。稍等片刻～`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }
  if (intent === 'task') {
    return `收到！我来处理「${q}」，有结果第一时间同步给你 ✅`;
  }
  if (intent === 'greeting') {
    return `你好呀，我是 ${ownerName} 的 AI 分身，有事直接说，我替 TA 先接住 🙂`;
  }
  return `我是 ${ownerName} 的 AI 分身。你说的「${q}」我记下了，${ownerName} 回来后我们会一起看，有需要随时找我～`;
}

function summarizeToolOutput(toolContent: string): string {
  // 工具返回是 JSON：{ summary: "..." } 或 { items: [...] }
  const data = parseJsonSafe<{
    summary?: string;
    items?: unknown[];
    ok?: boolean;
    message?: string;
  }>(toolContent);
  if (data?.summary) return data.summary;
  if (Array.isArray(data?.items)) {
    if (data.items.length === 0) return '目前没有查到相关记录。';
    return `查到 ${data.items.length} 条：${data.items
      .slice(0, 5)
      .map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))
      .join('；')}`;
  }
  if (data?.message) return data.message;
  return `已处理：${toolContent.slice(0, 120)}`;
}

/** 从中文时间表达中提取一个可读时间（演示用） */
function parseTime(text: string): string {
  const m =
    /(今天|明天|后天|下周[一二三四五六日天])?\s*(上午|下午|晚上|中午|早上)?\s*(\d{1,2})\s*[:：点]\s*(\d{1,2})?/.exec(
      text,
    );
  if (!m) return '明天 10:00';
  const day = m[1] ?? '明天';
  const period = m[2] ?? '';
  const hour = m[3].padStart(2, '0');
  const minute = (m[4] ?? '00').padStart(2, '0');
  return `${day}${period ? ` ${period}` : ''} ${hour}:${minute}`.trim();
}

export const mockProvider: Provider = {
  name: 'mock',
  async complete(req) {
    // 关键词规则只作用于触发消息，避免历史文本误触发工具
    const userText = req.mockHints?.triggerText ?? lastUserText(req.messages);
    const ownerName = ownerNameOf(req);
    const allow = new Set((req.tools ?? []).map((t) => t.name));

    // 审批通过后的续跑：基于已执行结果生成回复（不再发起工具调用）
    const resumeMsg = [...req.messages]
      .reverse()
      .find((m) => m.role === 'user' && m.content.includes('【系统事件】'));
    if (resumeMsg) {
      const resultText = resumeMsg.content.split('执行结果：')[1]?.split('\n')[0] ?? '';
      return textResult(summarizeToolOutput(resultText || '{}'), req, 0.95);
    }

    // 工具结果已回填 → 生成自然语言总结（ReAct 第二轮）
    const toolMsg = lastToolMessage(req.messages);
    if (toolMsg) {
      return textResult(summarizeToolOutput(toolMsg.content), req, 0.9);
    }

    // 高风险与转人规则（先于工具匹配）
    if (/转账|付款|打钱|红包|汇款|借钱|借款/.test(userText)) {
      if (allow.has('payment.send')) {
        const amount = Number(/(\d+(?:\.\d+)?)/.exec(userText)?.[1] ?? 500);
        return toolResult(
          'payment.send',
          { amount, currency: 'CNY', note: quote(userText, 40) },
          req,
        );
      }
      return handover('涉及资金操作，需要主人本人确认', req);
    }
    if (/合同|法律|起诉|律师|签署|承诺书/.test(userText)) {
      return handover('涉及法律事务，建议转交主人本人处理', req);
    }
    if (/报价|多少钱|价格|折扣|优惠/.test(userText)) {
      // 商务承诺：低置信度 → auto 档会按 escalate 规则转交
      return {
        ...composeLowConfidenceReply(userText, ownerName),
        usage: mockUsage(req),
        provider: 'mock',
        model: 'mock-1',
        costUsd: 0,
        toolCalls: [],
        confidence: 0.5,
      };
    }

    // 工具触发
    if (allow.has('calendar.read') && /日程|安排|会议|几点|有空|预约/.test(userText)) {
      return toolResult('calendar.read', { day: 'today' }, req);
    }
    if (
      allow.has('calendar.create') &&
      /(帮我约|订个|创建日程|添加日程|安排一个|安排一下|提醒我)/.test(userText)
    ) {
      return toolResult(
        'calendar.create',
        { title: quote(userText, 40), time: parseTime(userText) },
        req,
      );
    }
    if (
      allow.has('todo.add') &&
      /(记个?待办|记一下待办|加个待办|添加待办|加入待办|待办加)/.test(userText)
    ) {
      return toolResult(
        'todo.add',
        {
          text:
            userText
              .replace(/^.*?(?:记个?待办|加个待办|添加待办|加入待办)[:：]?\s*/, '')
              .slice(0, 120) || quote(userText, 120),
        },
        req,
      );
    }
    if (allow.has('todo.list') && /待办|todo|清单|任务列表/i.test(userText)) {
      return toolResult('todo.list', {}, req);
    }
    if (allow.has('translate') && /翻译/.test(userText)) {
      return toolResult('translate', { text: quote(userText, 200), targetLang: 'en' }, req);
    }
    if (allow.has('summarize') && /总结|纪要|归纳|概括/.test(userText)) {
      return toolResult('summarize', { text: quote(userText, 400) }, req);
    }
    if (allow.has('web.search') && /搜索|查一下|搜一下|网上/.test(userText)) {
      return toolResult('web.search', { query: quote(userText, 60) }, req);
    }

    // 通用文本回复
    const intent = /[?？]|吗|呢|怎么|什么|何时|为什么|能不能/.test(userText)
      ? 'question'
      : /^(你好|hi|hello|在吗|在不在)/i.test(userText)
        ? 'greeting'
        : /帮我|请|麻烦|需要你/.test(userText)
          ? 'task'
          : 'chat';
    return textResult(composeReply(userText, ownerName, intent), req);
  },
};

function composeLowConfidenceReply(userText: string, ownerName: string): { text: string } {
  return {
    text: `关于「${quote(userText)}」，这个涉及 ${ownerName} 的商务口径，我不太确定具体数字，建议等 ${ownerName} 本人确认后再答复你，避免给你错误信息 🙏`,
  };
}
