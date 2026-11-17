import { describe, expect, test } from 'bun:test';
import {
  AVATAR_COLORS,
  avatarColor,
  avatarColorKey,
  avatarForeground,
  avatarInitial,
} from '../src/avatar';

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (n: number) => {
    const c = n / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((value >> 16) & 0xff) +
    0.7152 * channel((value >> 8) & 0xff) +
    0.0722 * channel(value & 0xff)
  );
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('avatar 16 色板', () => {
  test('16 色且均为合法 HEX', () => {
    expect(AVATAR_COLORS).toHaveLength(16);
    for (const color of AVATAR_COLORS) expect(color).toMatch(/^#[0-9A-F]{6}$/i);
  });

  test('同一名称稳定，大小写与空白不影响', () => {
    expect(avatarColor('alice')).toBe(avatarColor('  ALICE '));
    expect(avatarInitial('  Alice ')).toBe('A');
  });

  test('同首字母映射同一颜色', () => {
    expect(avatarColor('alice')).toBe(avatarColor('alice 的分身'));
    expect(avatarColor('alice')).toBe(avatarColor('anna'));
    expect(avatarColor('alice')).not.toBe(avatarColor('bob'));
  });

  test('按大写首字母取色：中文取拼音首字母', () => {
    expect(avatarColorKey('alice')).toBe('A');
    expect(avatarColorKey('周末出游小分队')).toBe('Z');
    expect(avatarColorKey('张三')).toBe('Z');
    expect(avatarColorKey('王总')).toBe('W');
    expect(avatarColor('周末出游小分队')).toBe(avatarColor('张三'));
    expect(avatarColor('周末出游小分队')).not.toBe(avatarColor('王总'));
  });

  test('颜色始终来自色板', () => {
    for (const name of ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', '王总', '李雷']) {
      expect(AVATAR_COLORS).toContain(avatarColor(name));
    }
  });

  test('每种底色的最佳首字对比度 ≥ 4.5:1', () => {
    for (const color of AVATAR_COLORS) {
      const best = Math.max(contrast(color, '#FFFFFF'), contrast(color, '#141414'));
      expect(best).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('首字颜色与背景对比度 ≥ 4.5:1', () => {
    for (const name of ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', '王总', '李雷']) {
      expect(['#FFFFFF', '#141414']).toContain(avatarForeground(name));
      expect(contrast(avatarColor(name), avatarForeground(name))).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('不同首字母能命中不同颜色', () => {
    const used = new Set(
      ['alice', 'bob', 'carol', 'dave', 'erin', 'frank', 'grace', 'heidi'].map((name) =>
        avatarColor(name),
      ),
    );
    expect(used.size).toBeGreaterThan(1);
  });
});
