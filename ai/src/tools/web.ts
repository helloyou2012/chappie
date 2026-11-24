/**
 * 网页工具（真实网络请求）：
 *   web.search：Tavily / Brave（有 key 时优先）→ Bing HTML（默认，无需 key）→ DuckDuckGo
 *               短超时 + 失败熔断 + 5 分钟结果缓存，避免一次网络抖动把任务拖 15 秒
 *   web.fetch ：抓取公开网页并提取正文；带基础 SSRF 防护、重定向校验、大小/超时限制
 */
import { z } from 'zod';
import { config } from '../common/config';
import type { BuiltinTool } from '../tool-gateway';

const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 15_000;
const SEARCH_TIMEOUT_MS = 10_000;
const BING_TIMEOUT_MS = 8_000;
const DDG_TIMEOUT_MS = 5_000;
const SEARCH_CACHE_TTL_MS = 5 * 60_000;
const SEARCH_BLOCK_MS = 10 * 60_000;
const SEARCH_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    return true;
  }
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^0\./.test(host)) return true;
  return false;
}

export function assertPublicUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('只支持 http/https 链接');
  }
  if (isPrivateHost(url.hostname)) {
    throw new Error('不允许访问内网/本机地址');
  }
  return url;
}

async function readLimited(res: Response): Promise<string> {
  const body = res.body;
  if (!body) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        text += decoder.decode(value, { stream: true });
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return text;
}

async function fetchPublic(raw: string): Promise<{ url: string; res: Response }> {
  let current = assertPublicUrl(raw);
  for (let i = 0; i < 4; i++) {
    const res = await fetch(current, {
      redirect: 'manual',
      headers: {
        'user-agent': 'ChappieBot/1.0 (+https://chappie.run)',
        accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.8,*/*;q=0.5',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { url: current.toString(), res };
      current = assertPublicUrl(new URL(loc, current).toString());
      continue;
    }
    return { url: current.toString(), res };
  }
  throw new Error('重定向次数过多');
}

function htmlToText(html: string, maxChars = 6000): string {
  const withoutHead = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const text = withoutHead
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
  return decodeEntities(text).slice(0, maxChars);
}

function extractTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decodeEntities(m[1]!.replace(/<[^>]+>/g, ' ').trim()) : '';
}

interface SearchItem {
  title: string;
  url: string;
  snippet: string;
}

async function searchTavily(query: string, key: string): Promise<SearchItem[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: key, query, max_results: 5, search_depth: 'basic' }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`tavily ${res.status}`);
  const data = (await res.json()) as {
    results?: { title?: string; url?: string; content?: string }[];
  };
  return (data.results ?? []).map((r) => ({
    title: r.title ?? r.url ?? '',
    url: r.url ?? '',
    snippet: (r.content ?? '').slice(0, 300),
  }));
}

async function searchBrave(query: string, key: string): Promise<SearchItem[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '5');
  const res = await fetch(url, {
    headers: { 'x-subscription-token': key, accept: 'application/json' },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`brave ${res.status}`);
  const data = (await res.json()) as {
    web?: { results?: { title?: string; url?: string; description?: string }[] };
  };
  return (data.web?.results ?? []).map((r) => ({
    title: r.title ?? r.url ?? '',
    url: r.url ?? '',
    snippet: (r.description ?? '').slice(0, 300),
  }));
}

async function searchDuckDuckGo(query: string): Promise<SearchItem[]> {
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': SEARCH_UA,
    },
    body: new URLSearchParams({ q: query }).toString(),
    signal: AbortSignal.timeout(DDG_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`duckduckgo ${res.status}`);
  const html = await readLimited(res);
  const items: SearchItem[] = [];
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets: string[] = [];
  for (let m = snippetRe.exec(html); m; m = snippetRe.exec(html)) {
    snippets.push(htmlToText(m[1]!, 240));
  }
  let i = 0;
  for (let m = linkRe.exec(html); m; m = linkRe.exec(html)) {
    let href = decodeEntities(m[1]!);
    try {
      const u = new URL(href, 'https://duckduckgo.com');
      const uddg = u.searchParams.get('uddg');
      if (uddg) href = uddg;
    } catch {
      // 保留原链接
    }
    items.push({
      title: htmlToText(m[2]!, 180),
      url: href,
      snippet: snippets[i] ?? '',
    });
    i += 1;
    if (items.length >= 5) break;
  }
  return items;
}

/** Bing 结果链接可能是 /ck/a?...&u=a1<base64url> 的跳转，解出真实 URL */
function resolveBingUrl(href: string): string {
  try {
    const u = new URL(href, 'https://www.bing.com');
    if (!u.hostname.endsWith('bing.com')) return u.toString();
    const encoded = u.searchParams.get('u');
    if (encoded?.startsWith('a1')) {
      const b64 = encoded
        .slice(2)
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .replace(/[^A-Za-z0-9+/=]/g, '');
      const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const decoded = Buffer.from(pad, 'base64').toString('utf8');
      if (/^https?:\/\//.test(decoded)) return decoded;
    }
    return u.toString();
  } catch {
    return '';
  }
}

/** 纯解析：Bing 搜索结果页 → 标题/链接/摘要 */
export function parseBingResults(html: string): SearchItem[] {
  const items: SearchItem[] = [];
  const blocks = html.split(/<li[^>]+class="[^"]*b_algo[^"]*"/i).slice(1);
  for (const block of blocks) {
    const m = /<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!m) continue;
    const url = resolveBingUrl(decodeEntities(m[1]!));
    if (!url) continue;
    const title = htmlToText(m[2]!, 180);
    const snippetMatch = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    items.push({
      title,
      url,
      snippet: snippetMatch ? htmlToText(snippetMatch[1]!, 240) : '',
    });
    if (items.length >= 5) break;
  }
  return items;
}

async function fetchBing(url: URL): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'user-agent': SEARCH_UA,
      accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(BING_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`bing ${res.status}`);
  return readLimited(res);
}

async function searchBing(query: string): Promise<SearchItem[]> {
  // 有时 www.bing.com 会返回反爬/跳转页；再试一次 cn.bing.com 直连
  const urls = [
    (() => {
      const u = new URL('https://www.bing.com/search');
      u.searchParams.set('q', query);
      u.searchParams.set('setlang', 'zh-Hans');
      u.searchParams.set('form', 'QBLH');
      return u;
    })(),
    (() => {
      const u = new URL('https://cn.bing.com/search');
      u.searchParams.set('q', query);
      u.searchParams.set('setlang', 'zh-Hans');
      return u;
    })(),
  ];
  for (const url of urls) {
    const html = await fetchBing(url);
    const items = parseBingResults(html);
    if (items.length > 0) return items;
    if (/class="b_no"|b_no_/.test(html)) return [];
  }
  throw new Error('bing 未返回可解析结果');
}

/** 供 ICS 等工具复用：抓取公开文本并提供大小限制/重定向校验 */
export async function fetchPublicText(
  raw: string,
): Promise<{ url: string; text: string; contentType: string }> {
  const { url, res } = await fetchPublic(raw);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await readLimited(res);
  return { url, text, contentType: res.headers.get('content-type') ?? '' };
}

const searchCache = new Map<string, { at: number; items: SearchItem[] }>();
/** 失败熔断：避免每个查询都在不可达的搜索源上等超时 */
const searchBlockedUntil = new Map<string, number>();

function freeSearchAttempts(query: string): { name: string; run: () => Promise<SearchItem[]> }[] {
  const bing = { name: 'bing', run: () => searchBing(query) };
  const ddg = { name: 'duckduckgo', run: () => searchDuckDuckGo(query) };
  // 用户显式选 DDG 时仍保留 Bing 作为兜底
  return config.webSearchProvider === 'duckduckgo' ? [ddg, bing] : [bing, ddg];
}

async function runSearch(query: string): Promise<SearchItem[]> {
  const cacheKey = query.trim().toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL_MS) return cached.items;

  const attempts: { name: string; run: () => Promise<SearchItem[]> }[] = [];
  if (config.tavilyApiKey) {
    attempts.push({ name: 'tavily', run: () => searchTavily(query, config.tavilyApiKey) });
  }
  if (config.braveApiKey) {
    attempts.push({ name: 'brave', run: () => searchBrave(query, config.braveApiKey) });
  }
  attempts.push(...freeSearchAttempts(query));

  let lastError: unknown;
  const tried: string[] = [];
  for (const attempt of attempts) {
    if ((searchBlockedUntil.get(attempt.name) ?? 0) > Date.now()) continue;
    tried.push(attempt.name);
    try {
      const items = await attempt.run();
      // 空结果通常是反爬/临时抖动，不缓存，下次继续尝试
      if (items.length > 0) searchCache.set(cacheKey, { at: Date.now(), items });
      return items;
    } catch (e) {
      lastError = e;
      // 反爬页/解析为空属于临时抖动，不进入熔断，下次查询继续尝试
      if (!String(e).includes('未返回可解析结果')) {
        searchBlockedUntil.set(attempt.name, Date.now() + SEARCH_BLOCK_MS);
      }
    }
  }
  const names = tried.length > 0 ? tried.join('/') : '全部搜索源都在冷却中';
  throw new Error(`${names}: ${String(lastError ?? '没有可用的搜索源').slice(0, 120)}`);
}

export const webTools: BuiltinTool[] = [
  {
    id: 'web.search',
    name: '搜索',
    description: '在网络上搜索信息，返回标题、链接与摘要',
    risk: 'L0',
    idempotent: true,
    jsonSchema: {
      type: 'object',
      required: ['query'],
      properties: { query: { type: 'string', description: '搜索关键词' } },
    },
    validate: z.object({ query: z.string().min(1).max(200) }),
    async exec(args) {
      const query = String(args.query);
      try {
        const items = await runSearch(query);
        return {
          summary:
            items.length === 0
              ? `没有搜到与「${query}」相关的结果。`
              : `搜到 ${items.length} 条结果：${items
                  .slice(0, 3)
                  .map((x) => x.title)
                  .join('；')}`,
          items,
          provider: config.webSearchProvider,
        };
      } catch (e) {
        const hint =
          !config.tavilyApiKey && !config.braveApiKey
            ? ' 可在 .env 配置 TAVILY_API_KEY 或 BRAVE_API_KEY 使用更稳定的搜索源。'
            : '';
        return { ok: false, summary: `搜索失败：${String(e).slice(0, 160)}${hint}`, items: [] };
      }
    },
  },
  {
    id: 'web.fetch',
    name: '抓取网页',
    description: '抓取一个公开网页并提取标题与正文',
    risk: 'L0',
    idempotent: true,
    jsonSchema: {
      type: 'object',
      required: ['url'],
      properties: { url: { type: 'string', description: 'http/https 网页地址' } },
    },
    validate: z.object({ url: z.string().url().max(2000) }),
    async exec(args) {
      const raw = String(args.url);
      try {
        const { url, res } = await fetchPublic(raw);
        if (!res.ok) {
          return { ok: false, summary: `抓取失败：HTTP ${res.status}` };
        }
        const contentType = res.headers.get('content-type') ?? '';
        const body = await readLimited(res);
        const isHtml = /html|xhtml/i.test(contentType) || /<html/i.test(body.slice(0, 500));
        const title = isHtml ? extractTitle(body) : '';
        const text = isHtml ? htmlToText(body) : body.slice(0, 6000);
        return {
          ok: true,
          url,
          title,
          text,
          summary: text ? text.slice(0, 240) : '页面没有可提取的正文。',
        };
      } catch (e) {
        return { ok: false, summary: `抓取失败：${String(e).slice(0, 200)}` };
      }
    },
  },
];
