/**
 * 推送通知 —— 分身的注意力触达通道（主人离线时的产品闭环）。
 *
 * 设计纪律（design-essence §8「每个模块自己发推送」反模式）：
 *   唯一入口是 internal.pushCard 成功后调用 notifyForCard()，业务模块不各自发推送。
 *
 * 通道：Expo Push API（APNs / FCM 由 Expo 代发）。未配置 EXPO_ACCESS_TOKEN 时静默降级。
 */

import type { CardPayload } from '@chappie/contract';
import { config } from './config';
import { internal } from './internal';
import { log } from './log';

export interface PushMessage {
  title: string;
  body: string;
  /** 客户端自定义负载（点击跳转等） */
  data?: Record<string, unknown>;
}

const EXPO_MAX_BATCH = 100;

/** 发给某个用户所有已注册 pushToken 的设备；best-effort，失败不阻塞主链路 */
export async function pushToUser(userId: string, message: PushMessage): Promise<number> {
  if (!config.expoPushToken) return 0;
  let devices: Awaited<ReturnType<typeof internal.getDevices>>['devices'];
  try {
    ({ devices } = await internal.getDevices(userId));
  } catch (e) {
    log.warn('push: get devices failed', { userId, error: String(e) });
    return 0;
  }
  const tokens = devices
    .map((d) => d.pushToken)
    .filter((t): t is string => typeof t === 'string' && t.length > 0);
  if (tokens.length === 0) return 0;

  for (let i = 0; i < tokens.length; i += EXPO_MAX_BATCH) {
    const batch = tokens.slice(i, i + EXPO_MAX_BATCH).map((to) => ({
      to,
      title: message.title,
      body: message.body,
      sound: 'default',
      ...(message.data ? { data: message.data } : {}),
    }));
    try {
      const res = await fetch(config.expoPushUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.expoPushToken}`,
        },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        log.warn('push: expo api error', { status: res.status });
        continue;
      }
      const body = (await res.json().catch(() => null)) as {
        data?: { status?: string; message?: string }[] | null;
      } | null;
      const failures = (body?.data ?? []).filter((t) => t.status && t.status !== 'ok');
      if (failures.length > 0) {
        // DeviceNotRegistered 等票据级错误：记录即可（token 清理由客户端下次注册覆盖）
        log.warn('push: ticket errors', { failures: failures.slice(0, 5) });
      }
    } catch (e) {
      log.warn('push: send failed', { userId, error: String(e) });
    }
  }
  return tokens.length;
}

/**
 * 导出供测试：卡片 → 推送文案映射（draft/task 不推送）。
 * 推送只带 kind / 标题 / 业务 id，不拼接卡片摘要或工具参数，
 * 避免邮件正文、转账对象等敏感内容出现在锁屏通知里。
 */
export function previewOfCard(card: CardPayload): PushMessage | null {
  switch (card.kind) {
    case 'approval':
      return {
        title: card.title || '分身请求你的确认',
        body: '分身准备执行一个高风险操作，请打开应用确认。',
        data: { kind: card.kind, approvalId: card.approvalId },
      };
    case 'handover':
      return {
        title: '分身转交给你处理',
        body: '有一项任务需要你亲自处理，请打开应用查看。',
        data: { kind: card.kind, taskId: card.taskId },
      };
    case 'calendar_reminder':
      return {
        title: `日程提醒：${card.title}`,
        body: '日程即将开始。',
        data: { kind: card.kind, entryId: card.entryId },
      };
    case 'report':
      return {
        title: '分身日报已生成',
        body: '打开应用查看今天的日报。',
        data: { kind: card.kind, reportId: card.reportId, day: card.day },
      };
    case 'human_request':
      return {
        title: '对方请求真人接待',
        body: `${card.requesterName} 希望与你本人沟通。`,
        data: { kind: card.kind, requestId: card.requestId, convId: card.convId },
      };
    case 'reception_digest':
      return {
        title: '分身接待摘要',
        body: '分身已停止，交接摘要已生成。',
        data: { kind: card.kind, convId: card.convId ?? '' },
      };
    default:
      // draft / task：主人在场时高频出现，推送会造成骚扰 —— 不推
      return null;
  }
}

/**
 * internal.pushCard 成功后的统一推送挂钩（fire-and-forget，不阻塞主链路）。
 */
export async function notifyForCard(recipientUserId: string, card: CardPayload): Promise<void> {
  const message = previewOfCard(card);
  if (!message) return;
  // 在线用户能通过 WS 实时收到卡片，不再重复推送；查询失败按离线兜底。
  try {
    const presences = await internal.getPresence([recipientUserId]);
    if (presences.some((p) => p.userId === recipientUserId && p.online)) {
      log.info('push: skipped online user', { userId: recipientUserId, kind: card.kind });
      return;
    }
  } catch (e) {
    log.warn('push: presence check failed, fallback to send', {
      userId: recipientUserId,
      error: String(e),
    });
  }
  await pushToUser(recipientUserId, message).catch((e) => {
    log.warn('push: notifyForCard failed', { userId: recipientUserId, error: String(e) });
  });
}
