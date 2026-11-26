/** 文件元数据与存储操作（admin-api 上传 / AI 工具读取共用）。 */
import { createHash, createHmac } from 'node:crypto';
import { and, desc, eq, like } from 'drizzle-orm';
import { config } from './common/config';
import { db } from './common/db';
import { newId } from './common/log';
import { fileObject } from './db/schema';
import { deleteObject, getObject, putObject } from './files-storage';

export interface FileRecord {
  id: string;
  ownerId: string;
  name: string;
  mime: string;
  size: number;
  storageKey: string;
  createdAt: Date;
}

function sanitizeName(name: string): string {
  const base = Array.from(name)
    .filter((ch) => ch.charCodeAt(0) >= 0x20)
    .join('')
    .replace(/[/\\]/g, '_')
    .trim();
  return (base || 'file').slice(0, 200);
}

export function guessMime(name: string, fallback = 'application/octet-stream'): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    csv: 'text/csv',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  };
  return map[ext] ?? fallback;
}

export async function saveFile(params: {
  ownerId: string;
  name: string;
  mime?: string;
  bytes: Uint8Array;
}): Promise<FileRecord> {
  const name = sanitizeName(params.name);
  const mime = params.mime || guessMime(name);
  const id = newId('file');
  const digest = createHash('sha256').update(params.bytes).digest('hex').slice(0, 16);
  const storageKey = `files/${params.ownerId}/${id}-${digest}-${name}`;
  await putObject(storageKey, params.bytes, mime);
  const rows = await db
    .insert(fileObject)
    .values({
      id,
      ownerId: params.ownerId,
      name,
      mime,
      size: params.bytes.byteLength,
      storageKey,
    })
    .returning();
  const row = rows[0]!;
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    mime: row.mime,
    size: row.size,
    storageKey: row.storageKey,
    createdAt: row.createdAt,
  };
}

export async function listFiles(ownerId: string, limit = 30): Promise<FileRecord[]> {
  const rows = await db
    .select()
    .from(fileObject)
    .where(eq(fileObject.ownerId, ownerId))
    .orderBy(desc(fileObject.createdAt))
    .limit(Math.min(limit, 100));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt }));
}

/** 按 id 或文件名（精确/包含）查找；同名取最新。 */
export async function findFile(ownerId: string, idOrName: string): Promise<FileRecord | null> {
  const q = idOrName.trim();
  if (!q) return null;
  const byId = await db
    .select()
    .from(fileObject)
    .where(and(eq(fileObject.ownerId, ownerId), eq(fileObject.id, q)))
    .limit(1);
  if (byId[0]) return { ...byId[0], createdAt: byId[0].createdAt };
  const byName = await db
    .select()
    .from(fileObject)
    .where(and(eq(fileObject.ownerId, ownerId), like(fileObject.name, `%${q}%`)))
    .orderBy(desc(fileObject.createdAt))
    .limit(1);
  return byName[0] ? { ...byName[0], createdAt: byName[0].createdAt } : null;
}

export async function readFileBytes(file: FileRecord): Promise<Uint8Array> {
  return getObject(file.storageKey);
}

/** 按 id 取文件（不校验 owner，供签名 URL 使用） */
export async function getFileById(id: string): Promise<FileRecord | null> {
  const rows = await db.select().from(fileObject).where(eq(fileObject.id, id)).limit(1);
  return rows[0] ? { ...rows[0], createdAt: rows[0].createdAt } : null;
}

export function fileSignature(id: string): string {
  return createHmac('sha256', config.fileUrlSecret).update(id).digest('hex').slice(0, 32);
}

/** 相对签名 URL：客户端用 adminUrl 前缀解析；会话成员无需登录 cookie 即可访问 */
export function signedFileUrl(id: string): string {
  return `/files/${id}?sig=${fileSignature(id)}`;
}

export async function removeFile(ownerId: string, idOrName: string): Promise<FileRecord | null> {
  const file = await findFile(ownerId, idOrName);
  if (!file) return null;
  await deleteObject(file.storageKey);
  await db
    .delete(fileObject)
    .where(and(eq(fileObject.id, file.id), eq(fileObject.ownerId, ownerId)));
  return file;
}
