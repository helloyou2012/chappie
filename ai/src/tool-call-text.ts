/**
 * 部分模型（尤其 OpenAI/Anthropic 兼容网关）会把工具调用以文本标记形式输出：
 *   <tool_call>{"name":"calendar.create","arguments":{...}}</tool_call>
 * 这类内容不应展示给用户，也必须从最终消息里剥离（工具本身走结构化 toolCalls）。
 */

const OPEN_TAGS = ['tool_call', 'tool_calls', 'function_call'] as const;

/** 无状态剥离：可处理完整块、多个块、大小写、未闭合块（剥到文末） */
export function stripToolCallMarkup(text: string): string {
  let out = text;
  for (const name of OPEN_TAGS) {
    out = out.replace(new RegExp(`<${name}>[\\s\\S]*?(?:</${name}>|$)`, 'gi'), '');
  }
  // <|tool_call|> ... <|/tool_call|>
  out = out.replace(/<\|tool_call\|>[\s\S]*?(?:<\|\/tool_call\|>|$)/gi, '');
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 流式过滤器：跨 delta 识别开/闭标签，标签内的内容直接丢弃。
 * 未匹配到标签时保留末尾 HOLD_BACK 个字符，避免把被切开的 `<tool_call>` 提前吐出。
 */
export class ToolCallTextFilter {
  private raw = '';
  private openName: string | null = null;

  push(delta: string): string {
    this.raw += delta;
    return this.drain(false);
  }

  /** 一轮模型输出结束时调用：吐出保留区（未闭合的工具块丢弃） */
  flush(): string {
    return this.drain(true);
  }

  private drain(final: boolean): string {
    let out = '';
    for (;;) {
      if (this.openName) {
        const closeTag = `</${this.openName}>`;
        const idx = this.raw.toLowerCase().indexOf(closeTag);
        if (idx < 0) {
          // 块内内容不需要保留；未闭合时整段丢弃
          if (final) this.raw = '';
          return out;
        }
        this.raw = this.raw.slice(idx + closeTag.length);
        this.openName = null;
        continue;
      }

      const lower = this.raw.toLowerCase();
      let idx = -1;
      let name: string | null = null;
      for (const candidate of OPEN_TAGS) {
        const i = lower.indexOf(`<${candidate}>`);
        if (i >= 0 && (idx < 0 || i < idx)) {
          idx = i;
          name = candidate;
        }
      }

      if (idx < 0) {
        const holdBack = final ? 0 : 24;
        const cut = Math.max(0, this.raw.length - holdBack);
        out += this.raw.slice(0, cut);
        this.raw = this.raw.slice(cut);
        return out;
      }

      out += this.raw.slice(0, idx);
      this.raw = this.raw.slice(idx + name!.length + 2);
      this.openName = name;
    }
  }
}
