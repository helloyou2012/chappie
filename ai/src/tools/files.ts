/**
 * 文件工具：列表 / 读取（文本、PDF）/ 写入文本 / 删除。
 * 内容存储由 files-storage 选择 S3 或本地目录；上传入口在 admin-api /admin/v1/files。
 */
import { z } from 'zod';
import { extractFileText } from '../file-extract';
import { findFile, listFiles, readFileBytes, removeFile, saveFile } from '../files';
import type { BuiltinTool } from '../tool-gateway';

const TEXT_LIMIT = 8000;

export const fileTools: BuiltinTool[] = [
  {
    id: 'file.list',
    name: '查看文件',
    description: '列出你上传的文件（名称、类型、大小、时间）',
    risk: 'L0',
    idempotent: true,
    jsonSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: '条数，默认 20' } },
    },
    validate: z.object({ limit: z.number().int().min(1).max(100).optional() }),
    async exec(args, ctx) {
      const files = await listFiles(ctx.ownerId, Number(args.limit ?? 20));
      return {
        summary:
          files.length === 0
            ? '你还没有上传过文件。'
            : `共 ${files.length} 个文件：${files
                .slice(0, 5)
                .map((f) => f.name)
                .join('、')}`,
        items: files.map((f) => ({
          id: f.id,
          name: f.name,
          mime: f.mime,
          size: f.size,
          createdAt: f.createdAt,
        })),
      };
    },
  },
  {
    id: 'file.read',
    name: '读取文件',
    description: '读取一个已上传文件的文本内容（支持 txt/md/json/csv/pdf/docx/xlsx）',
    risk: 'L0',
    idempotent: true,
    jsonSchema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', description: '文件 id 或文件名' } },
    },
    validate: z.object({ file: z.string().min(1).max(200) }),
    async exec(args, ctx) {
      const record = await findFile(ctx.ownerId, String(args.file));
      if (!record) return { ok: false, summary: `没找到文件「${String(args.file)}」。` };
      const bytes = await readFileBytes(record);
      if (record.mime.startsWith('image/')) {
        return {
          ok: true,
          file: { id: record.id, name: record.name, mime: record.mime, size: record.size },
          summary: `「${record.name}」是图片（${record.mime}，${record.size} 字节），暂不支持 OCR。`,
          text: '',
        };
      }
      const parsed = await extractFileText({
        mime: record.mime,
        name: record.name,
        bytes,
      });
      if ('error' in parsed) return { ok: false, summary: parsed.error };
      const clipped = parsed.text.slice(0, TEXT_LIMIT);
      return {
        ok: true,
        file: { id: record.id, name: record.name, mime: record.mime, size: record.size },
        text: clipped,
        summary: `「${record.name}」内容摘要：${clipped.slice(0, 240)}`,
      };
    },
  },
  {
    id: 'file.write',
    name: '保存文件',
    description: '把一段文本保存为文件（低风险写操作）',
    risk: 'L1',
    idempotent: false,
    jsonSchema: {
      type: 'object',
      required: ['name', 'text'],
      properties: {
        name: { type: 'string', description: '文件名，如 notes.md' },
        text: { type: 'string', description: '文件内容' },
      },
    },
    validate: z.object({
      name: z.string().min(1).max(200),
      text: z.string().min(1).max(200_000),
    }),
    async exec(args, ctx) {
      const file = await saveFile({
        ownerId: ctx.ownerId,
        name: String(args.name),
        bytes: new TextEncoder().encode(String(args.text)),
      });
      return {
        ok: true,
        file: { id: file.id, name: file.name, size: file.size },
        summary: `已保存文件「${file.name}」（${file.size} 字节）。`,
      };
    },
  },
  {
    id: 'file.delete',
    name: '删除文件',
    description: '删除一个已上传文件（高风险，需主人确认）',
    risk: 'L2',
    idempotent: false,
    jsonSchema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', description: '文件 id 或文件名' } },
    },
    validate: z.object({ file: z.string().min(1).max(200) }),
    async exec(args, ctx) {
      const removed = await removeFile(ctx.ownerId, String(args.file));
      return removed
        ? { ok: true, summary: `已删除文件「${removed.name}」。` }
        : { ok: false, summary: `没找到文件「${String(args.file)}」。` };
    },
  },
];
