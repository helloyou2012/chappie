/**
 * 多模态输入：从会话里的图片消息解析文件 id，读取对象存储字节，转成 base64 传给视觉模型。
 * 仅在 MODEL_MULTIMODAL=true 时启用；文本/PDF 仍走 file.read 工具。
 */
import type { Message } from '@chappie/contract';
import { config } from './common/config';
import { log } from './common/log';
import { extractFileText } from './file-extract';
import { getFileById, readFileBytes } from './files';
import type { PromptImage } from './model-gateway/types';

const SUPPORTED = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export function fileIdFromUrl(url: string): string | null {
  const m = /\/files\/([^/?#]+)/.exec(url);
  return m?.[1] ?? null;
}

function normalizeMime(mime: string): string {
  const base = mime.split(';')[0]!.trim().toLowerCase();
  return base === 'image/jpg' ? 'image/jpeg' : base;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function isValidPng(bytes: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 16 || signature.some((v, i) => bytes[i] !== v)) return false;
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const len = readU32(bytes, pos);
    if (pos + 12 + len > bytes.length) return false;
    const type = bytes.subarray(pos + 4, pos + 8);
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    const expected = readU32(bytes, pos + 8 + len);
    if (crc32(concat(type, data)) !== expected) return false;
    const name = String.fromCharCode(...type);
    if (name === 'IEND') return true;
    pos += 12 + len;
  }
  return false;
}

/** 发送前做基本完整性校验，避免损坏图片让整次模型请求 400 */
export function isValidImage(mime: string, bytes: Uint8Array): boolean {
  if (mime === 'image/png') return isValidPng(bytes);
  if (mime === 'image/jpeg') {
    return (
      bytes.length > 4 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[bytes.length - 2] === 0xff &&
      bytes[bytes.length - 1] === 0xd9
    );
  }
  if (mime === 'image/gif') {
    const sig = String.fromCharCode(...bytes.subarray(0, 6));
    return sig === 'GIF87a' || sig === 'GIF89a';
  }
  if (mime === 'image/webp') {
    const riff = String.fromCharCode(...bytes.subarray(0, 4));
    const webp = String.fromCharCode(...bytes.subarray(8, 12));
    return riff === 'RIFF' && webp === 'WEBP';
  }
  return false;
}

export interface PromptFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  text: string;
}

/** 自动读取最近的非图片附件（文本/PDF/DOCX/XLSX），供提示词直接分析 */
export async function loadPromptFiles(trigger: Message, history: Message[]): Promise<PromptFile[]> {
  if (!config.fileAutoRead) return [];

  const cutoff = Date.now() - config.fileAutoReadWindowMs;
  const urls: string[] = [];
  for (const m of [...history, trigger]) {
    if (m.content?.type !== 'file' || typeof m.content.url !== 'string') continue;
    if (new Date(m.createdAt).getTime() < cutoff) continue;
    urls.push(m.content.url);
  }
  const unique = [...new Set(urls)].slice(-Math.max(1, config.fileAutoReadMaxFiles));

  const out: PromptFile[] = [];
  for (const url of unique) {
    const id = fileIdFromUrl(url);
    if (!id) continue;
    try {
      const record = await getFileById(id);
      if (!record || record.size > config.fileAutoReadMaxBytes) continue;
      if (record.mime.startsWith('image/')) continue;
      const bytes = await readFileBytes(record);
      const parsed = await extractFileText({
        mime: record.mime,
        name: record.name,
        bytes,
      });
      if ('error' in parsed) continue;
      const clipped = Array.from(parsed.text).slice(0, config.fileAutoReadMaxChars).join('');
      if (!clipped.trim()) continue;
      out.push({
        id: record.id,
        name: record.name,
        mime: record.mime,
        size: record.size,
        text: clipped,
      });
    } catch (e) {
      log.warn('load prompt file failed', { id, error: String(e).slice(0, 160) });
    }
  }
  return out;
}

export async function loadPromptImages(
  trigger: Message,
  history: Message[],
): Promise<PromptImage[]> {
  if (!config.modelMultimodal) return [];

  const urls: string[] = [];
  for (const m of [...history, trigger]) {
    if (m.content?.type === 'image' && typeof m.content.url === 'string') {
      urls.push(m.content.url);
    }
  }
  const unique = [...new Set(urls)].slice(-Math.max(1, config.multimodalMaxImages));

  const images: PromptImage[] = [];
  let total = 0;
  for (const url of unique) {
    const id = fileIdFromUrl(url);
    if (!id) continue;
    try {
      const record = await getFileById(id);
      if (!record) continue;
      const mime = normalizeMime(record.mime);
      if (!SUPPORTED.has(mime)) continue;
      const bytes = await readFileBytes(record);
      if (bytes.byteLength > config.multimodalMaxImageBytes) continue;
      if (total + bytes.byteLength > config.multimodalMaxTotalBytes) continue;
      if (!isValidImage(mime, bytes)) {
        log.warn('skip invalid image attachment', { id, mime, bytes: bytes.byteLength });
        continue;
      }
      total += bytes.byteLength;
      images.push({ mime, data: Buffer.from(bytes).toString('base64') });
    } catch (e) {
      log.warn('load prompt image failed', { id, error: String(e).slice(0, 160) });
    }
  }
  return images;
}
