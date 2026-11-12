/** 意图分类规则（纯函数，不依赖外部服务）—— 设计方案 §4.4 决策流水线第 3 步。 */
import { describe, expect, test } from 'bun:test';
import { classify } from '../src/classifier';

describe('classify 意图 / 紧急度 / 情绪', () => {
  test('疑问句 → question 且需要回应', () => {
    const c = classify('你明天有空吗？');
    expect(c.intent).toBe('question');
    expect(c.needReply).toBe(true);
  });

  test('祈使任务 → task 且需要回应', () => {
    const c = classify('帮我订一张明天的票');
    expect(c.intent).toBe('task');
    expect(c.needReply).toBe(true);
  });

  test('紧急关键词 → urgency=high，即使不是问句也需要回应', () => {
    const c = classify('尽快把材料发我');
    expect(c.urgency).toBe('high');
    expect(c.needReply).toBe(true);
  });

  test('辱骂/愤怒 → emotion 且需要回应', () => {
    const c = classify('这也太过分了吧，气死我了');
    expect(c.intent).toBe('emotion');
    expect(c.sentiment).toBe('angry');
    expect(c.needReply).toBe(true);
  });

  test('通知类 → notice，普通闲聊 → chat，二者通常无需回应', () => {
    expect(classify('通知：明天九点开会').intent).toBe('notice');
    const chat = classify('今天天气不错');
    expect(chat.intent).toBe('chat');
    expect(chat.needReply).toBe(false);
  });

  test('情绪负向 / 正向识别', () => {
    expect(classify('有点失望').sentiment).toBe('negative');
    expect(classify('谢谢，太好了').sentiment).toBe('positive');
    expect(classify('收到').sentiment).toBe('positive');
  });
});

describe('classify 敏感话题', () => {
  test('资金 / 健康 / 法律 / 隐私按序命中', () => {
    expect(classify('帮我转账 200 元').topics).toContain('money');
    expect(classify('明天去医院复查').topics).toContain('health');
    expect(classify('这个合同要找律师看一下').topics).toContain('legal');
    expect(classify('把验证码发我').topics).toContain('privacy');
  });

  test('多话题同时命中', () => {
    const c = classify('医院账单要付款，还要签合同');
    expect(c.topics).toEqual(expect.arrayContaining(['money', 'health', 'legal']));
  });

  test('无敏感话题时为空数组', () => {
    expect(classify('晚上一起吃饭').topics).toEqual([]);
  });
});

describe('classify 摘要', () => {
  test('压缩空白并截断到 80 字符', () => {
    const c = classify(`${'多行\n\n文本'.repeat(1)}\n${'x'.repeat(200)}`);
    expect(c.summary.length).toBeLessThanOrEqual(80);
    expect(c.summary).not.toContain('\n');
  });
});

describe('classify 置信度（合理沉默依据）', () => {
  test('明确任务 / 紧急 / 愤怒 → 高置信度', () => {
    expect(classify('帮我订一张明天的票').confidence).toBeGreaterThanOrEqual(0.7);
    expect(classify('尽快把材料发我').confidence).toBeGreaterThanOrEqual(0.7);
    expect(classify('气死我了').confidence).toBeGreaterThanOrEqual(0.7);
  });

  test('极短消息 / 纯问号 → 低置信度', () => {
    expect(classify('？').confidence).toBeLessThan(0.6);
    expect(classify('在吗').confidence).toBeLessThan(0.6);
  });

  test('正常问句置信度高于裸问号', () => {
    expect(classify('你明天有空吗？').confidence).toBeGreaterThan(classify('？').confidence);
  });

  test('置信度始终在 0..1', () => {
    for (const text of ['', '？', '帮我转账 200 元并立刻处理', '谢谢']) {
      const c = classify(text).confidence;
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});
