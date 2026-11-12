/**
 * 意图分类（规则先行）—— 设计方案 §4.4 决策流水线第 3 步。
 * 设计原则：先走廉价规则过滤，避免每条消息都调用大模型（成本关键，§14）。
 * 配置了 CLASSIFIER_* 小模型时，可在规则不确定处增强（此处保留接口）。
 */

export type Intent = 'chat' | 'question' | 'task' | 'notice' | 'emotion';
export type Urgency = 'low' | 'normal' | 'high';
export type Sentiment = 'neutral' | 'positive' | 'negative' | 'angry';

export interface Classification {
  intent: Intent;
  urgency: Urgency;
  sentiment: Sentiment;
  needReply: boolean;
  /** 命中的敏感话题（money/health/legal/privacy） */
  topics: string[];
  /** 规则置信度（0..1）：用于群聊自动档的「合理沉默」与审计 */
  confidence: number;
  /** 供审计/回放的一句话摘要 */
  summary: string;
}

const URGENT_RE = /急|马上|立刻|尽快|赶紧|asap|urgent/i;
const QUESTION_RE = /[?？]|吗|呢|怎么|什么|何时|为什么|能不能|有没有|可不可以|是不是/;
const TASK_RE = /帮我|请|麻烦|订|约|提醒|查一下|查下|处理|安排|预约|创建/;
const ANGRY_RE = /气死|无语|过分|垃圾|滚|骗|投诉|妈的|fuck|shit/i;
const NEGATIVE_RE = /不行|不好|失望|不满|生气|难过|烦/;
const POSITIVE_RE = /谢谢|多谢|感谢|太好了|不错|赞|棒|好的|收到/;
const NOTICE_RE = /通知|公告|会议安排|周报|日报|提醒你/;

export function classify(text: string): Classification {
  const topics: string[] = [];
  if (/钱|转账|付款|费用|价格|报价|借款|红包|汇款/.test(text)) topics.push('money');
  if (/病|医院|健康|药|体检|身体/.test(text)) topics.push('health');
  if (/合同|法律|律师|起诉|协议|签署/.test(text)) topics.push('legal');
  if (/身份证|护照|密码|验证码|银行卡/.test(text)) topics.push('privacy');

  const urgency: Urgency = URGENT_RE.test(text) ? 'high' : 'normal';
  const sentiment: Sentiment = ANGRY_RE.test(text)
    ? 'angry'
    : NEGATIVE_RE.test(text)
      ? 'negative'
      : POSITIVE_RE.test(text)
        ? 'positive'
        : 'neutral';

  const intent: Intent = ANGRY_RE.test(text)
    ? 'emotion'
    : QUESTION_RE.test(text)
      ? 'question'
      : TASK_RE.test(text)
        ? 'task'
        : NOTICE_RE.test(text)
          ? 'notice'
          : 'chat';

  const needReply =
    intent === 'question' || intent === 'task' || urgency === 'high' || intent === 'emotion';

  // 规则强度：越明确的请求置信度越高；极短/纯问号消息更低（供合理沉默使用）
  let confidence = 0.5;
  if (QUESTION_RE.test(text)) confidence += 0.2;
  if (TASK_RE.test(text)) confidence += 0.25;
  if (URGENT_RE.test(text)) confidence += 0.3;
  if (ANGRY_RE.test(text)) confidence += 0.3;
  const compact = text.replace(/\s+/g, '');
  if (compact.length < 4) confidence -= 0.2;
  if (/^[?？]+$/.test(compact)) confidence -= 0.3;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    intent,
    urgency,
    sentiment,
    needReply,
    topics,
    confidence,
    summary: text.replace(/\s+/g, ' ').slice(0, 80),
  };
}
