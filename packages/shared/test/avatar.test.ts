import { describe, expect, test } from 'bun:test';
import { avatarColor, avatarColors, avatarPalette, DUOTONE_PALETTES } from '../src/avatar';

describe('avatar duotone 色板', () => {
  test('每组 5 色，共 20 组', () => {
    expect(DUOTONE_PALETTES).toHaveLength(20);
    for (const palette of DUOTONE_PALETTES) {
      expect(palette).toHaveLength(5);
      for (const color of palette) expect(color).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  test('同一名称稳定，大小写与空白不影响', () => {
    expect(avatarPalette('alice')).toEqual(avatarPalette('  ALICE '));
    expect(avatarColors('alice')).toEqual(avatarColors('  ALICE '));
    expect(avatarColor('alice')).toBe(avatarColor('  ALICE '));
  });

  test('同首字母映射同一颜色', () => {
    expect(avatarPalette('alice')).toEqual(avatarPalette('alice 的分身'));
    expect(avatarColor('alice')).toBe(avatarColor('alice 的分身'));
    expect(avatarColor('alice')).toBe(avatarColor('anna'));
    expect(avatarPalette('alice')).not.toEqual(avatarPalette('bob'));
  });

  test('纯色取压暗后的深次色', () => {
    const colors = avatarColors('alice');
    expect(colors.from).toMatch(/^#[0-9A-F]{6}$/i);
    expect(colors.to).toMatch(/^#[0-9A-F]{6}$/i);
    expect(avatarColor('alice')).toBe(colors.to);
  });

  test('不同首字母能命中不同色板', () => {
    const palettes = new Set(
      ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'].map((name) => avatarPalette(name)),
    );
    expect(palettes.size).toBeGreaterThan(1);
  });
});
