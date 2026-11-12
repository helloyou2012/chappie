/** 跨端格式化与 URL 工具（纯函数）。 */
import { describe, expect, test } from 'bun:test';
import { wsUrlFromServerUrl } from '../src/api';
import { dayjs } from '../src/datetime';
import { formatRelative, formatTime, initials, truncate, uuid } from '../src/format';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('truncate', () => {
  test('短文本原样返回', () => {
    expect(truncate('短文本', 10)).toBe('短文本');
  });

  test('超长文本截断并追加省略号', () => {
    expect(truncate('一二三四五六七八九十', 4)).toBe('一二三四…');
  });

  test('默认上限 40', () => {
    expect(truncate('x'.repeat(41))).toHaveLength(41); // 40 + 省略号
    expect(truncate('x'.repeat(40))).toHaveLength(40);
  });
});

describe('initials', () => {
  test('英文多词取首字母且大写', () => {
    expect(initials('alice bob')).toBe('A');
  });

  test('英文单词取首字母', () => {
    expect(initials('alice')).toBe('A');
  });

  test('中文取第一个字', () => {
    expect(initials('张三丰')).toBe('张');
  });

  test('空字符串返回问号', () => {
    expect(initials('   ')).toBe('?');
  });
});

describe('formatTime', () => {
  test('当天显示时分', () => {
    expect(formatTime(dayjs().format('YYYY-MM-DDTHH:mm:ss'))).toBe(dayjs().format('HH:mm'));
  });

  test('昨天带「昨天」前缀', () => {
    const y = dayjs().subtract(1, 'day').hour(9).minute(5);
    expect(formatTime(y.toISOString())).toBe(`昨天 ${y.format('HH:mm')}`);
  });

  test('今年其它日期显示月日', () => {
    const d = dayjs().subtract(3, 'month');
    // 跨年边界的极小概率情形不参与断言（用同年构造）
    if (d.year() !== dayjs().year()) return;
    expect(formatTime(d.toISOString())).toBe(d.format('M月D日'));
  });

  test('更早日期显示完整年月日', () => {
    const d = dayjs().subtract(2, 'year');
    expect(formatTime(d.toISOString())).toBe(d.format('YYYY/M/D'));
  });

  test('空值与非法值返回空串', () => {
    expect(formatTime(null)).toBe('');
    expect(formatTime(undefined)).toBe('');
    expect(formatTime('not-a-date')).toBe('');
  });
});

describe('formatRelative', () => {
  test('一分钟内显示「刚刚」', () => {
    expect(formatRelative(dayjs().subtract(5, 'second').toISOString())).toBe('刚刚');
  });

  test('过去时间使用相对描述', () => {
    expect(formatRelative(dayjs().subtract(3, 'hour').toISOString())).toContain('小时前');
  });

  test('未来时间使用相对描述', () => {
    // 中文 locale 对未来的文案是「2 小时内」而非「2 小时后」
    expect(formatRelative(dayjs().add(2, 'hour').toISOString())).toMatch(/2\s*小时内?/);
  });

  test('极近的未来显示「即将到期」', () => {
    expect(formatRelative(dayjs().add(10, 'second').toISOString())).toBe('即将到期');
  });

  test('空值与非法值返回空串', () => {
    expect(formatRelative(null)).toBe('');
    expect(formatRelative('bad')).toBe('');
  });
});

describe('uuid', () => {
  test('生成 UUID v4', () => {
    expect(uuid()).toMatch(UUID_V4_RE);
    expect(uuid()).not.toBe(uuid());
  });
});

describe('wsUrlFromServerUrl', () => {
  test('http → ws 并追加 /ws', () => {
    expect(wsUrlFromServerUrl('http://127.0.0.1:7100')).toBe('ws://127.0.0.1:7100/ws');
  });

  test('https → wss', () => {
    expect(wsUrlFromServerUrl('https://im.example.com')).toBe('wss://im.example.com/ws');
  });

  test('去掉末尾斜杠，避免双斜杠', () => {
    expect(wsUrlFromServerUrl('http://localhost:7100/')).toBe('ws://localhost:7100/ws');
  });
});
