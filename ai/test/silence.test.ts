/** 合理沉默：只在群聊 auto + 未被 @ + 低置信度时生效。 */
import { describe, expect, test } from 'bun:test';
import { type SilenceInput, shouldStaySilent } from '../src/silence';

const BASE: SilenceInput = {
  convType: 'group',
  systemTag: null,
  mode: 'auto',
  mentioned: false,
  mentionsOwner: false,
  senderId: 'u2',
  ownerId: 'u1',
  hasReply: false,
  urgency: 'normal',
  sentiment: 'neutral',
  topics: [],
  text: '今天天气不错',
  ownerName: 'Alice',
  needReply: true,
  confidence: 0.5,
  threshold: 0.6,
};

function input(over: Partial<SilenceInput>): SilenceInput {
  return { ...BASE, ...over };
}

describe('shouldStaySilent', () => {
  test('群聊 auto 低置信度且未被 @ → 沉默', () => {
    expect(shouldStaySilent(input({}))).toBe(true);
  });

  test('私聊不沉默', () => {
    expect(shouldStaySilent(input({ convType: 'direct' }))).toBe(false);
  });

  test('草稿档不沉默', () => {
    expect(shouldStaySilent(input({ mode: 'draft' }))).toBe(false);
  });

  test('手动/静默档不走此规则', () => {
    expect(shouldStaySilent(input({ mode: 'manual' }))).toBe(false);
    expect(shouldStaySilent(input({ mode: 'off' }))).toBe(false);
  });

  test('被 @ 或被 @ 主人都不沉默', () => {
    expect(shouldStaySilent(input({ mentioned: true }))).toBe(false);
    expect(shouldStaySilent(input({ mentionsOwner: true }))).toBe(false);
  });

  test('主人本人发言不沉默', () => {
    expect(shouldStaySilent(input({ senderId: 'u1' }))).toBe(false);
  });

  test('回复延续不沉默', () => {
    expect(shouldStaySilent(input({ hasReply: true }))).toBe(false);
  });

  test('紧急/愤怒/敏感话题不沉默', () => {
    expect(shouldStaySilent(input({ urgency: 'high' }))).toBe(false);
    expect(shouldStaySilent(input({ sentiment: 'angry' }))).toBe(false);
    expect(shouldStaySilent(input({ topics: ['money'] }))).toBe(false);
  });

  test('文本提到主人姓名不沉默', () => {
    expect(shouldStaySilent(input({ text: 'Alice 明天有空吗' }))).toBe(false);
  });

  test('置信度达到阈值不沉默', () => {
    expect(shouldStaySilent(input({ confidence: 0.6 }))).toBe(false);
    expect(shouldStaySilent(input({ confidence: 0.59 }))).toBe(true);
  });

  test('阈值为 0 时关闭沉默', () => {
    expect(shouldStaySilent(input({ threshold: 0 }))).toBe(false);
  });

  test('无需回应时不走沉默（由上游意图过滤处理）', () => {
    expect(shouldStaySilent(input({ needReply: false }))).toBe(false);
  });
});
