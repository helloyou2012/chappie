/**
 * 演示数据 + 能力注册。
 *
 * 1) 注册内置能力（幂等）—— 新 avatar 在 user.created 时自动获得授权；
 * 2) 通过公开 API 走完整登录链路注册 alice / bob（需要 core 已启动 + AUTH_CODE_DEV_ECHO=true）；
 * 3) 创建单聊、群聊并发送演示消息，便于立即体验 @ 分身。
 *
 * 运行：pnpm ai:seed（需 cargo run 与 pnpm ai 已启动）
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import { closeDb, db } from './common/db';
import { capability, capabilityGrant } from './db/schema';
import { BUILTIN_TOOLS } from './tool-gateway';

const API = process.env.GATEWAY_URL ?? 'http://127.0.0.1:7100';
const ADMIN = process.env.ADMIN_URL ?? 'http://127.0.0.1:7002';

interface AuthResult {
  token: string;
  user: { id: string; name: string; email: string };
}

async function post<T>(url: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function get<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function login(email: string): Promise<AuthResult> {
  const send = await post<{ devCode: string | null }>(`${API}/api/v1/auth/code/send`, { email });
  if (!send.devCode) {
    throw new Error('验证码未回显：请将 .env 中 AUTH_CODE_DEV_ECHO=true（或从 core 日志中取码）');
  }
  return post<AuthResult>(`${API}/api/v1/auth/code/verify`, { email, code: send.devCode });
}

async function waitAvatarReady(token: string, name: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      await get(`${ADMIN}/admin/v1/avatar`, token);
      return;
    } catch (e) {
      if (String(e).includes('409')) {
        await sleep(500);
        continue;
      }
      throw e;
    }
  }
  console.warn(`⚠️  ${name} 的分身初始化超时（检查 ai worker 是否在运行）`);
}

async function ensureCapabilities(): Promise<void> {
  for (const tool of BUILTIN_TOOLS) {
    await db
      .insert(capability)
      .values({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        schema: tool.jsonSchema as Record<string, unknown>,
        riskLevel: tool.risk,
        provider: 'builtin',
        version: 1,
      })
      .onConflictDoUpdate({
        target: capability.id,
        set: {
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          schema: sql`excluded.schema`,
          riskLevel: sql`excluded.risk_level`,
          version: sql`${capability.version} + 1`,
        },
      });
  }
  // 为已存在的分身补齐授权（cross join）
  await db.execute(sql`
    INSERT INTO ${capabilityGrant} (avatar_id, capability_id, granted)
    SELECT a.id, c.id, TRUE FROM avatar a CROSS JOIN capability c
    ON CONFLICT DO NOTHING
  `);
  console.log(`✅ 能力注册完成（${BUILTIN_TOOLS.length} 个）`);
}

async function main() {
  await ensureCapabilities();

  console.log('→ 注册演示账号 alice@demo.dev / bob@demo.dev …');
  const alice = await login('alice@demo.dev');
  const bob = await login('bob@demo.dev');
  console.log(`   alice=${alice.user.id} bob=${bob.user.id}`);

  await Promise.all([waitAvatarReady(alice.token, 'alice'), waitAvatarReady(bob.token, 'bob')]);

  // 已有会话则复用
  const convs = await get<{
    views: {
      conversation: { id: string; type: string; systemTag: string | null };
      displayTitle: string;
    }[];
  }>(`${API}/api/v1/conversations`, alice.token);
  const hasDirect = convs.views.some(
    (v) => v.conversation.type === 'direct' && v.conversation.systemTag === null,
  );

  if (!hasDirect) {
    await post(
      `${API}/api/v1/conversations`,
      { type: 'direct', memberUserIds: [bob.user.id] },
      alice.token,
    );
    console.log('✅ 已创建 alice ↔ bob 单聊');
  }

  const hasGroup = convs.views.some((v) => v.conversation.type === 'group');
  if (!hasGroup) {
    await post(
      `${API}/api/v1/conversations`,
      { type: 'group', memberUserIds: [bob.user.id], title: '周末出游小分队' },
      alice.token,
    );
    console.log('✅ 已创建群聊「周末出游小分队」');
  }

  console.log('\n🎉 演示数据就绪。打开 http://localhost:5173：');
  console.log('   1) 用 alice@demo.dev 登录（验证码会显示在响应/日志中）');
  console.log('   2) 另开一个隐私窗口用 bob@demo.dev 登录');
  console.log('   3) 在单聊/群里发消息，或 @ 对方的分身试试');
  console.log('   4) 在「我的分身」会话里可直接对分身下达指令；切档位可体验 手动/草稿/自动/静默\n');
}

if (import.meta.main) {
  await main().catch((e) => {
    console.error('seed failed:', e);
    process.exit(1);
  });
  await closeDb();
}
