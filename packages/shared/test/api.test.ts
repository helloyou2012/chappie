/** REST 客户端：URL 组装、鉴权头、错误映射、204/网络异常、401 回调。 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ApiError, adminApi, api, configureApi } from '../src/api';

const originalFetch = globalThis.fetch;
let calls: { url: string; init: RequestInit }[] = [];
let unauthorized = 0;

beforeEach(() => {
  calls = [];
  unauthorized = 0;
  configureApi({
    serverUrl: 'http://core.test',
    adminUrl: 'http://admin.test',
    getToken: () => 'tok',
    onUnauthorized: () => {
      unauthorized += 1;
    },
  });
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return Response.json({ views: [] });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function lastCall() {
  const call = calls.at(-1);
  return { url: call?.url ?? '', init: call?.init ?? {} };
}

describe('server API', () => {
  test('拼接到 serverUrl 并携带 Bearer 令牌', async () => {
    await api.listConversations();
    const { url, init } = lastCall();
    expect(url).toBe('http://core.test/api/v1/conversations');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  test('无令牌时不携带 authorization', async () => {
    configureApi({ getToken: () => null });
    await api.me();
    const { init } = lastCall();
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  test('POST 请求序列化 JSON body', async () => {
    await api.sendCode('alice@demo.dev');
    const { init } = lastCall();
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ email: 'alice@demo.dev' }));
  });

  test('listMessages 正确拼接 beforeSeq / limit，缺省不带查询串', async () => {
    await api.listMessages('c1', { beforeSeq: 10, limit: 20 });
    expect(lastCall().url).toBe(
      'http://core.test/api/v1/conversations/c1/messages?beforeSeq=10&limit=20',
    );
    await api.listMessages('c1');
    expect(lastCall().url).toBe('http://core.test/api/v1/conversations/c1/messages');
  });

  test('204 返回 undefined', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
    expect(await api.logout()).toBeUndefined();
  });
});

describe('admin API', () => {
  test('使用 adminUrl 前缀', async () => {
    await adminApi.getAvatar();
    expect(lastCall().url).toBe('http://admin.test/admin/v1/avatar');
  });
});

describe('错误映射', () => {
  test('非 2xx 解析错误体并抛出 ApiError', async () => {
    globalThis.fetch = (async () =>
      Response.json(
        { error: { code: 'avatar_not_ready', message: '分身正在初始化' } },
        { status: 409 },
      )) as typeof fetch;
    const err = await api.listConversations().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe('avatar_not_ready');
    expect(err.message).toBe('分身正在初始化');
    expect(err.isAvatarNotReady).toBe(true);
  });

  test('错误体无法解析时回退 statusText', async () => {
    globalThis.fetch = (async () => new Response('oops', { status: 500 })) as typeof fetch;
    const err = await api.listConversations().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
  });

  test('401 触发 onUnauthorized 且 isUnauthorized 为真', async () => {
    globalThis.fetch = (async () => new Response('no', { status: 401 })) as typeof fetch;
    const err = await api.me().catch((e) => e);
    expect(err.isUnauthorized).toBe(true);
    expect(unauthorized).toBe(1);
  });

  test('网络异常映射为 status=0 的 ApiError', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as typeof fetch;
    const err = await api.me().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.code).toBe('network');
    expect(err.message).toContain('无法连接服务器');
  });
});
