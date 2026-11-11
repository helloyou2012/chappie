/** 消息内容 → 预览文本（三端列表/引用共用），未知类型必须给出降级文案。 */
import { describe, expect, test } from 'bun:test';
import { type Content, contentText } from './src/chat';

const text = (t: string): Content => ({ type: 'text', schemaVersion: 1, text: t });

describe('contentText', () => {
  test('文本原样返回', () => {
    expect(contentText(text('你好'))).toBe('你好');
  });

  test('空值返回空串', () => {
    expect(contentText(null)).toBe('');
    expect(contentText(undefined)).toBe('');
  });

  test('图片带可选文件名', () => {
    expect(contentText({ type: 'image', schemaVersion: 1, url: 'u', name: '猫.png' })).toBe(
      '[图片] 猫.png',
    );
    expect(contentText({ type: 'image', schemaVersion: 1, url: 'u' })).toBe('[图片]');
  });

  test('文件带文件名', () => {
    expect(contentText({ type: 'file', schemaVersion: 1, url: 'u', name: '合同.pdf' })).toBe(
      '[文件] 合同.pdf',
    );
  });

  test('各类卡片预览', () => {
    const card = (payload: Record<string, unknown>): Content =>
      ({ type: 'card', schemaVersion: 1, card: payload }) as unknown as Content;
    expect(contentText(card({ kind: 'draft' }))).toBe('[草稿卡片]');
    expect(contentText(card({ kind: 'approval', title: '请求执行：转账' }))).toBe(
      '[确认卡片] 请求执行：转账',
    );
    expect(contentText(card({ kind: 'task', title: '查询日程' }))).toBe('[任务卡片] 查询日程');
    expect(contentText(card({ kind: 'handover' }))).toBe('[转交卡片]');
    expect(contentText(card({ kind: 'report', day: '2026-01-01' }))).toBe('[分身日报] 2026-01-01');
  });
});
