/** avatar 级工具数据读写（tool_data 表）。独立成模块，避免工具模块与 tool-gateway 循环依赖。 */
import { and, eq, sql } from 'drizzle-orm';
import { db } from './common/db';
import { toolData } from './db/schema';

export async function readToolData<T>(avatarId: string, kind: string, fallback: T): Promise<T> {
  const rows = await db
    .select({ data: toolData.data })
    .from(toolData)
    .where(and(eq(toolData.avatarId, avatarId), eq(toolData.kind, kind)));
  return rows.length ? ((rows[0]!.data as T) ?? fallback) : fallback;
}

export async function writeToolData(avatarId: string, kind: string, data: unknown): Promise<void> {
  await db
    .insert(toolData)
    .values({ avatarId, kind, data })
    .onConflictDoUpdate({
      target: [toolData.avatarId, toolData.kind],
      set: { data, updatedAt: sql`now()` },
    });
}
