/**
 * AI 侧迁移 runner（与 core 的 sqlx migrate 分目录管理 —— 设计方案 §30.3）。
 * 运行：pnpm ai:migrate
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { closeDb, db } from './common/db';
import { schemaMigrationsAi } from './db/schema';

const dir = join(import.meta.dir, '..', 'migrations');

await db.execute(sql`
  CREATE TABLE IF NOT EXISTS schema_migrations_ai (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`);

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

for (const file of files) {
  const applied = await db
    .select({ name: schemaMigrationsAi.name })
    .from(schemaMigrationsAi)
    .where(eq(schemaMigrationsAi.name, file));
  if (applied.length > 0) {
    console.log(`skip   ${file}`);
    continue;
  }
  const content = readFileSync(join(dir, file), 'utf8');
  const statements = content
    .split(';')
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length > 0 &&
        !s.split('\n').every((line) => line.trim().startsWith('--') || line.trim() === ''),
    );

  await db.transaction(async (tx) => {
    for (const stmt of statements) {
      await tx.execute(sql.raw(stmt));
    }
    await tx.insert(schemaMigrationsAi).values({ name: file });
  });
  console.log(`apply  ${file} (${statements.length} statements)`);
}

console.log('✅ ai migrations up to date');
await closeDb();
