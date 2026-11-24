/** 图片完整性校验：损坏 PNG 不应进入多模态请求。 */
import { describe, expect, test } from 'bun:test';
import { isValidImage } from '../src/attachments';

const goodPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP4z8AARwzEcQCukw/x0F8jngAAAABJRU5ErkJggg==',
  'base64',
);
const badPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1a0AAAAASUVORK5CYII=',
  'base64',
);

describe('isValidImage', () => {
  test('完整 PNG 通过', () => {
    expect(isValidImage('image/png', goodPng)).toBe(true);
  });

  test('损坏/CRC 不匹配的 PNG 被拒绝', () => {
    expect(isValidImage('image/png', badPng)).toBe(false);
  });

  test('非图片字节被拒绝', () => {
    expect(isValidImage('image/png', new TextEncoder().encode('not an image'))).toBe(false);
  });
});
