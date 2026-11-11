/**
 * 导出 fixtures.json —— Rust 集成契约测试的数据源。
 * 运行：pnpm --filter @chappie/contract export:fixtures
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtures } from '../src/fixtures';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'fixtures.json');

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(fixtures, null, 2)}\n`, 'utf8');
console.log(`fixtures.json written: ${out} (${Object.keys(fixtures).length} entries)`);
