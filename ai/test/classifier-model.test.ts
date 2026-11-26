import { describe, expect, test } from 'bun:test';
import { classify } from '../src/classifier';
import { applyReplyDecision, type ReplyDecision } from '../src/classifier-model';

function decision(overrides: Partial<ReplyDecision> = {}): ReplyDecision {
  return { label: 'reply', needReply: true, confidence: 0.9, ...overrides };
}

describe('mmBERT reply 决策合并', () => {
  test('高置信 reply 会放行', () => {
    const rules = classify('明天中午外滩集合');
    const merged = applyReplyDecision(rules, decision());
    expect(merged.needReply).toBe(true);
    expect(merged.intent).toBe(rules.intent);
    expect(merged.confidence).toBe(0.9);
  });

  test('高置信 silent 会压掉规则 needReply', () => {
    const rules = classify('明天几点集合？');
    const merged = applyReplyDecision(rules, decision({ label: 'silent', needReply: false }));
    expect(merged.needReply).toBe(false);
    expect(merged.intent).toBe('question');
  });

  test('低置信不覆盖规则', () => {
    const rules = classify('明天几点集合？');
    const merged = applyReplyDecision(rules, decision({ confidence: 0.5 }));
    expect(merged).toEqual(rules);
  });

  test('敏感/紧急/愤怒消息不能被模型降级为不回', () => {
    const rules = classify('这笔转账要多少钱？');
    const merged = applyReplyDecision(rules, decision({ label: 'silent', needReply: false }));
    expect(merged.needReply).toBe(true);
  });

  test('无模型结果保持规则', () => {
    const rules = classify('明天几点集合？');
    expect(applyReplyDecision(rules, null)).toEqual(rules);
  });
});
