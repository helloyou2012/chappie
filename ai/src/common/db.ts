/**
 * 数据库访问（Drizzle ORM + postgres.js）。
 *
 * - schema 定义见 `ai/src/db/schema.ts`（AI 表可写；core 表仅 SELECT，outbox 除外）；
 * - Drizzle 自动完成 snake_case ↔ camelCase 与 JSONB 解析，无需手写行转换；
 * - 复杂 SQL（SKIP LOCKED、咨询锁、FILTER 聚合）使用 Drizzle 的 `sql` 模板，仍保持参数化安全。
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../db/schema';
import { config } from './config';

export const client = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  // 迁移中的 CREATE TABLE IF NOT EXISTS 会触发 duplicate_table notice，静默即可
  onnotice: () => {},
});

export const db = drizzle(client, { schema });
export type Db = typeof db;

/** 关闭连接池（迁移脚本与服务退出时使用） */
export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}
