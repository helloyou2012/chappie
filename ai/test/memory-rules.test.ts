/** 记忆抽取与哈希伪向量（纯函数）—— 设计方案 §9 记忆分层与治理。 */
import { describe, expect, test } from 'bun:test';
import type { Content, Message } from '@chappie/contract';
import { extractFromMessages, extractKeywords, hashEmbedding } from '../src/memory';

const OWNER = 'u_owner';
const PEER = 'u_peer';

function msg(senderId: string, content: Content): Message {
  return {
    msgId: `m_${Math.random().toString(36).slice(2)}`,
    convId: 'c_1',
    seq: 1,
    senderId,
    senderType: 'human',
    content,
    createdAt: new Date().toISOString(),
  } as Message;
}

const text = (t: string): Content => ({ type: 'text', schemaVersion: 1, text: t });

describe('hashEmbedding', () => {
  test('固定 256 维且确定性', () => {
    const a = hashEmbedding('明天下午三点开会');
    const b = hashEmbedding('明天下午三点开会');
    expect(a).toHaveLength(256);
    expect(a).toEqual(b);
  });

  test('非空文本近似单位长度', () => {
    const v = hashEmbedding('产品评审会与一对一沟通安排');
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeGreaterThan(0.99);
    expect(norm).toBeLessThan(1.01);
  });

  test('不同文本向量不同', () => {
    expect(hashEmbedding('苹果香蕉')).not.toEqual(hashEmbedding('合同报价'));
  });

  test('空文本返回全零向量', () => {
    expect(hashEmbedding('').every((x) => x === 0)).toBe(true);
  });
});

describe('extractKeywords', () => {
  test('过滤停用词并去重，保持首次出现顺序', () => {
    expect(extractKeywords('苹果 苹果 香蕉 的 了 西瓜')).toEqual(['苹果', '香蕉', '西瓜']);
  });

  test('超长词拆分为两段', () => {
    expect(extractKeywords('项目管理方法论')).toEqual(['项目管理', '方法论']);
  });

  test('最多返回 8 个关键词', () => {
    const words = Array.from({ length: 12 }, (_, i) => `词条${i}`).join(' ');
    expect(extractKeywords(words).length).toBe(8);
  });

  test('单字与空串不产出关键词', () => {
    expect(extractKeywords('我 你 他')).toEqual([]);
    expect(extractKeywords('')).toEqual([]);
  });
});

describe('extractFromMessages', () => {
  test('只从主人消息抽取，他人消息忽略', () => {
    const items = extractFromMessages(
      [msg(OWNER, text('我叫小明')), msg(PEER, text('我叫小红'))],
      OWNER,
      PEER,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'fact',
      scope: 'global',
      content: '名字：小明',
      peerId: null,
    });
  });

  test('偏好抽取为全局记忆', () => {
    const items = extractFromMessages([msg(OWNER, text('我喜欢喝美式咖啡'))], OWNER, PEER);
    expect(items).toContainEqual(
      expect.objectContaining({
        type: 'preference',
        scope: 'global',
        content: expect.stringContaining('喝美式咖啡'),
      }),
    );
  });

  test('承诺抽取为联系人记忆并绑定 peerId', () => {
    const items = extractFromMessages([msg(OWNER, text('明天我会把资料发给你'))], OWNER, PEER);
    expect(items).toContainEqual(
      expect.objectContaining({ type: 'commitment', scope: 'contact', peerId: PEER }),
    );
  });

  test('敏感信息标记为 sensitive 且作用域为联系人', () => {
    const items = extractFromMessages([msg(OWNER, text('我的银行卡密码是 123456'))], OWNER, PEER);
    expect(items).toContainEqual(
      expect.objectContaining({
        type: 'fact',
        scope: 'contact',
        peerId: PEER,
        sensitivity: 'sensitive',
      }),
    );
  });

  test('非文本消息不抽取', () => {
    const items = extractFromMessages(
      [msg(OWNER, { type: 'image', schemaVersion: 1, url: 'x', name: '我叫小明.png' })],
      OWNER,
      PEER,
    );
    expect(items).toEqual([]);
  });

  test('相同内容去重并保留高置信度', () => {
    const items = extractFromMessages(
      [msg(OWNER, text('我喜欢喝咖啡')), msg(OWNER, text('我喜欢喝咖啡'))],
      OWNER,
      PEER,
    );
    const prefs = items.filter((i) => i.type === 'preference');
    expect(prefs).toHaveLength(1);
    expect(prefs[0]?.confidence).toBe(0.8);
  });
});
