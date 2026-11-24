/** Bing 搜索页解析（纯函数）。 */
import { describe, expect, test } from 'bun:test';
import { parseBingResults } from '../src/tools/web';

describe('parseBingResults', () => {
  test('解析 b_algo 结果并解码 ck/a 跳转链接', () => {
    const encoded = Buffer.from('https://example.com/result', 'utf8').toString('base64url');
    const html = `
      <li class="b_algo"><h2><a href="https://example.com/a">Example <strong>Title</strong></a></h2><p>Example snippet</p></li>
      <li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1${encoded}">Second</a></h2><p>Second snippet</p></li>`;
    const items = parseBingResults(html);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      title: 'Example Title',
      url: 'https://example.com/a',
      snippet: 'Example snippet',
    });
    expect(items[1]?.url).toBe('https://example.com/result');
  });

  test('无结果时返回空数组', () => {
    expect(parseBingResults('<html><body>no results</body></html>')).toEqual([]);
  });
});
