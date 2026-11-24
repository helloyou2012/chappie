/**
 * Server-Sent Events 解析（Anthropic / OpenAI 流式响应共用）。
 * 只依赖 fetch 的 ReadableStream，不引入额外 SDK。
 */

export interface SseEvent {
  event?: string;
  data: string;
}

export async function* readSse(res: Response): AsyncGenerator<SseEvent> {
  const body = res.body;
  if (!body) throw new Error('SSE 响应缺少 body');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // 事件以空行分隔；兼容 \r\n
      let sep = buffer.search(/\r?\n\r?\n/);
      while (sep >= 0) {
        const chunk = buffer.slice(0, sep);
        const sepLen = buffer.startsWith('\r\n', sep) ? 4 : 2;
        buffer = buffer.slice(sep + sepLen);
        let event: string | undefined;
        const dataLines: string[] = [];
        for (const raw of chunk.split(/\r?\n/)) {
          if (raw.startsWith('event:')) event = raw.slice(6).trim();
          else if (raw.startsWith('data:')) dataLines.push(raw.slice(5).replace(/^ /, ''));
          // id: / retry: / 注释行忽略
        }
        if (dataLines.length > 0) yield { event, data: dataLines.join('\n') };
        sep = buffer.search(/\r?\n\r?\n/);
      }
    }
    // 收尾：有些实现最后一条事件没有空行
    const tail = buffer.trim();
    if (tail) {
      let event: string | undefined;
      const dataLines: string[] = [];
      for (const raw of tail.split(/\r?\n/)) {
        if (raw.startsWith('event:')) event = raw.slice(6).trim();
        else if (raw.startsWith('data:')) dataLines.push(raw.slice(5).replace(/^ /, ''));
      }
      if (dataLines.length > 0) yield { event, data: dataLines.join('\n') };
    }
  } finally {
    reader.releaseLock();
  }
}

/** 流式响应非 2xx：抛出带响应体的错误（与现有 provider 的错误格式一致） */
export async function assertStreamOk(res: Response, provider: string): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => '');
  throw new Error(`${provider} ${res.status}: ${body.slice(0, 500)}`);
}

/** 把文本切成小块按节奏回调（mock / 降级用，模拟真实流式的逐字观感） */
export async function emitTextChunks(
  text: string,
  onDelta?: (delta: string) => void,
  size = 12,
  intervalMs = 40,
): Promise<void> {
  if (!onDelta || !text) return;
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i += size) {
    onDelta(chars.slice(i, i + size).join(''));
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
