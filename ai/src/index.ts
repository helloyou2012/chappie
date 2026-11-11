/**
 * ai-platform 入口 —— 设计方案 §27.2 角色拆分：
 *   --role=worker    消费 outbox、执行 Agent 流水线
 *   --role=scheduler 定时任务（日报、审批超时）
 *   --role=admin     控制台 API
 *   --role=all       全部（开发默认）
 */

import { startAdminServer } from './admin-api';
import { config } from './common/config';
import { log } from './common/log';
import { runOutboxWorker } from './outbox-worker';
import { runScheduler } from './scheduler';

function parseRole(): 'worker' | 'scheduler' | 'admin' | 'all' {
  const arg = process.argv.find((a) => a.startsWith('--role='));
  const role = arg?.slice('--role='.length) ?? 'all';
  if (role === 'worker' || role === 'scheduler' || role === 'admin' || role === 'all') return role;
  return 'all';
}

const role = parseRole();
const controller = new AbortController();

process.on('SIGINT', () => {
  log.info('shutting down', { role });
  controller.abort();
  setTimeout(() => process.exit(0), 300);
});
process.on('SIGTERM', () => {
  controller.abort();
  setTimeout(() => process.exit(0), 300);
});

log.info('ai-platform starting', {
  role,
  provider: config.modelProvider,
  internal: config.internalBaseUrl,
  adminPort: config.adminPort,
});

if (role === 'worker' || role === 'all') {
  void runOutboxWorker(controller.signal);
}
if (role === 'scheduler' || role === 'all') {
  void runScheduler(controller.signal);
}
if (role === 'admin' || role === 'all') {
  startAdminServer();
}

if (role === 'admin') {
  // admin 角色由 Bun.serve 保持进程存活
}
