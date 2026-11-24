/**
 * 回复流式器 —— 真实模型增量 + 持久化/重连：
 *   - 首个文本/思考增量时在会话中创建一条 ownerOnly 消息（只有主人可见）；
 *   - 增量按 ~80ms / ~120 字批量写入 core（update-stream-text），客户端收到 message_updated；
 *   - 思考内容随 ai_meta.thinking 一起更新，仅主人可见；
 *   - 定稿时才决定对外可见（visible）或保持 ownerOnly（草稿/护栏/转交）；
 *   - 消息落在 DB，刷新/重连后主人能看到已生成的部分内容。
 * 流式失败不应阻断任务：写入 core 失败 → 关闭流式，最终仍走一次性的正常发送。
 */

import type { AgentActivityItem } from '@chappie/contract';
import { internal } from './common/internal';
import { log } from './common/log';
import { ToolCallTextFilter } from './tool-call-text';

const FLUSH_INTERVAL_MS = 80;
const FLUSH_CHARS = 120;

export interface StreamerParams {
  enabled: boolean;
  /** 崩溃恢复/续跑时复用此前的流式消息 */
  initialMsgId?: string | null;
  /** 续跑/审批恢复时沿用此前的工具活动 */
  initialActivity?: AgentActivityItem[];
  /** 续跑/审批恢复时沿用此前的思考内容 */
  initialThinking?: string;
  /** 创建流式消息（agent-runtime 提供完整 sendMessage 参数），返回 msgId */
  createMessage: (text: string, thinking: string, activity: AgentActivityItem[]) => Promise<string>;
}

export class ReplyStreamer {
  private msgId: string | null;
  private text = '';
  private thinking = '';
  private activity: AgentActivityItem[] = [];
  private pending = '';
  private lastFlushAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private closed = false;
  /** 已写入 core 的文本/思考/活动：轮次边界重复 flush 时跳过无变化的写入 */
  private lastFlushedText = '';
  private lastFlushedThinking = '';
  private lastFlushedActivity = '[]';
  /** 过滤模型以文本形式输出的 <tool_call> 标记 */
  private textFilter = new ToolCallTextFilter();

  constructor(private readonly params: StreamerParams) {
    this.msgId = params.initialMsgId ?? null;
    if (params.initialActivity?.length) {
      this.activity = [...params.initialActivity];
      this.lastFlushedActivity = JSON.stringify(this.activity);
    }
    if (params.initialThinking) {
      this.thinking = params.initialThinking;
      this.lastFlushedThinking = params.initialThinking;
    }
  }

  get enabled(): boolean {
    return this.params.enabled && !this.closed;
  }

  get id(): string | null {
    return this.msgId;
  }

  get currentText(): string {
    return this.text;
  }

  get currentThinking(): string {
    return this.thinking;
  }

  get currentActivity(): AgentActivityItem[] {
    return this.activity;
  }

  /** 工具执行后更新活动时间线（不重置文本；会立即安排一次写入） */
  setActivity(items: AgentActivityItem[]): void {
    if (!this.enabled) return;
    this.activity = items;
    this.scheduleFlush(0);
  }

  /**
   * 新一轮模型调用：正文以「替换」语义写入（旧一轮的中间文本让位给最终答复）；
   * 思考则跨轮累积——工具轮常产生思考、最终答复轮可能没有，不能丢。
   */
  beginRound(): void {
    this.text = '';
    this.pending = '';
    this.lastFlushedText = '';
    this.textFilter = new ToolCallTextFilter();
  }

  /** 本轮模型输出结束：吐出过滤器的保留区（被丢弃的工具块不会进入正文） */
  endRound(): void {
    const clean = this.textFilter.flush();
    if (!clean) return;
    this.text += clean;
    this.pending += clean;
    this.scheduleFlush(0);
  }

  /** 文本增量回调（provider 调用）：过滤文本形式的工具调用标记 */
  push(delta: string): void {
    if (!this.enabled || !delta) return;
    const clean = this.textFilter.push(delta);
    if (!clean) return;
    this.text += clean;
    this.pending += clean;
    this.scheduleNextFlush();
  }

  /** 思考增量回调（provider 调用） */
  pushThinking(delta: string): void {
    if (!this.enabled || !delta) return;
    this.thinking += delta;
    this.pending += delta;
    this.scheduleNextFlush();
  }

  private scheduleNextFlush(): void {
    const now = Date.now();
    const wait = FLUSH_INTERVAL_MS - (now - this.lastFlushAt);
    if (this.pending.length >= FLUSH_CHARS || wait <= 0) this.scheduleFlush(0);
    else this.scheduleFlush(wait);
  }

  private scheduleFlush(delay: number): void {
    if (this.timer || this.closed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  /** 立即写一次（轮次边界 / 挂起 / 定稿前） */
  async flush(): Promise<void> {
    if (!this.enabled) return;
    const activityJson = JSON.stringify(this.activity);
    if (
      this.text === this.lastFlushedText &&
      this.thinking === this.lastFlushedThinking &&
      activityJson === this.lastFlushedActivity
    ) {
      return;
    }
    const text = this.text;
    const thinking = this.thinking;
    const activity = this.activity;
    this.lastFlushedText = text;
    this.lastFlushedThinking = thinking;
    this.lastFlushedActivity = activityJson;
    this.pending = '';
    this.lastFlushAt = Date.now();
    this.chain = this.chain.then(async () => {
      if (!this.enabled) return;
      try {
        if (!this.msgId) {
          this.msgId = await this.params.createMessage(text, thinking, activity);
        } else {
          await internal.updateStreamText(
            this.msgId,
            text,
            thinking || undefined,
            activity.length > 0 ? activity : undefined,
          );
        }
      } catch (e) {
        // 流式是增强能力：写失败就关掉，最终仍会走正常的一次性发送
        this.closed = true;
        log.warn('streaming disabled after write failure', { error: String(e).slice(0, 200) });
      }
    });
    await this.chain;
  }

  /**
   * 定稿：visible=true 对外可见（并进入 AI 事件链路）；false 保持 ownerOnly。
   * text 为 null 时保留当前流式内容（中断/取消场景）。
   * 返回流式消息 id；流式未启用/未产生内容时返回 null，调用方回退到普通发送。
   */
  async finalize(
    text: string | null,
    visible: boolean,
    aiMeta: Record<string, unknown>,
  ): Promise<string | null> {
    if (!this.params.enabled) return null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.chain.catch(() => undefined);

    if (!this.msgId) {
      if (!text && !this.thinking && this.activity.length === 0) return null;
      try {
        this.msgId = await this.params.createMessage(
          text ?? this.text,
          this.thinking,
          this.activity,
        );
      } catch (e) {
        log.warn('streaming create failed at finalize', { error: String(e).slice(0, 200) });
        return null;
      }
    }

    try {
      await internal.finalizeStreamMessage({
        msgId: this.msgId,
        text,
        aiMeta,
        visible,
      });
      this.closed = true;
      return this.msgId;
    } catch (e) {
      log.warn('streaming finalize failed', { error: String(e).slice(0, 200) });
      return null;
    }
  }

  /** 中断收尾：保留已生成内容，仅主人可见，并附一句状态说明。 */
  async abort(note: string, aiMeta: Record<string, unknown>): Promise<void> {
    if (!this.params.enabled) return;
    const tail = this.textFilter.flush();
    if (tail) this.text += tail;
    const text = this.text ? `${this.text}\n\n（${note}）` : null;
    // 若已因写入失败关闭流式，仍尝试定稿（core 侧消息可能已存在）
    this.closed = false;
    await this.finalize(text, false, aiMeta);
  }
}
