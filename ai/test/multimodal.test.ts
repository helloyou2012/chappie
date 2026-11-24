/** 多模态：图片附件应转换成各 provider 的图片内容块。 */
import { afterEach, describe, expect, test } from 'bun:test';
import { anthropicProvider } from '../src/model-gateway/anthropic';
import { openaiChatProvider, openaiResponsesProvider } from '../src/model-gateway/openai';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const images = [{ mime: 'image/png', data: 'AAAA' }];

function captureFetch(response: unknown): { body?: Record<string, unknown> } {
  const captured: { body?: Record<string, unknown> } = {};
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    captured.body = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return captured;
}

describe('多模态图片输入', () => {
  test('anthropic：首条 user 消息包含 image block', async () => {
    const captured = captureFetch({
      model: 'claude-x',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await anthropicProvider.complete(
      { system: 'sys', messages: [{ role: 'user', content: '看图' }], images },
      { model: 'claude-x', baseUrl: 'http://mock', apiKey: 'k' },
    );
    const messages = captured.body?.messages as {
      role: string;
      content: { type: string; source?: { type: string; media_type: string; data: string } }[];
    }[];
    expect(messages[0]?.role).toBe('user');
    const image = messages[0]?.content.find((b) => b.type === 'image');
    expect(image?.source).toEqual({ type: 'base64', media_type: 'image/png', data: 'AAAA' });
  });

  test('openai-chat：user 消息包含 image_url data URL', async () => {
    const captured = captureFetch({
      model: 'gpt-x',
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    await openaiChatProvider.complete(
      { system: 'sys', messages: [{ role: 'user', content: '看图' }], images },
      { model: 'gpt-x', baseUrl: 'http://mock/v1', apiKey: 'k' },
    );
    const messages = captured.body?.messages as {
      role: string;
      content: { type: string; image_url?: { url: string } }[];
    }[];
    expect(messages[1]?.role).toBe('user');
    const image = messages[1]?.content.find((c) => c.type === 'image_url');
    expect(image?.image_url?.url).toBe('data:image/png;base64,AAAA');
  });

  test('openai-responses：input 包含 input_image', async () => {
    const captured = captureFetch({
      model: 'gpt-x',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await openaiResponsesProvider.complete(
      { system: 'sys', messages: [{ role: 'user', content: '看图' }], images },
      { model: 'gpt-x', baseUrl: 'http://mock/v1', apiKey: 'k' },
    );
    const input = captured.body?.input as {
      role: string;
      content: { type: string; image_url?: string }[];
    }[];
    const image = input[0]?.content.find((c) => c.type === 'input_image');
    expect(image?.image_url).toBe('data:image/png;base64,AAAA');
  });
});
