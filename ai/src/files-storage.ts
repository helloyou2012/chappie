/**
 * 文件对象存储抽象：
 *   - 配置了 S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY → S3 兼容存储
 *   - 否则落本地目录（FILE_LOCAL_DIR，默认 .data/files）
 */
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from './common/config';

export function s3Configured(): boolean {
  return Boolean(
    config.s3Endpoint && config.s3Bucket && config.s3AccessKeyId && config.s3SecretAccessKey,
  );
}

let client: S3Client | null = null;

function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: config.s3Region || 'us-east-1',
      endpoint: config.s3Endpoint || undefined,
      forcePathStyle: config.s3ForcePathStyle,
      credentials: {
        accessKeyId: config.s3AccessKeyId,
        secretAccessKey: config.s3SecretAccessKey,
      },
    });
  }
  return client;
}

function localPath(key: string): string {
  // key 由服务端生成；normalize 后再次限制在本地目录内
  const safe = normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
  return join(process.cwd(), config.fileLocalDir, safe);
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  if (s3Configured()) {
    await s3().send(
      new PutObjectCommand({
        Bucket: config.s3Bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return;
  }
  const path = localPath(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
}

export async function getObject(key: string): Promise<Uint8Array> {
  if (s3Configured()) {
    const res = await s3().send(new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }));
    if (!res.Body) throw new Error('S3 返回空对象');
    return res.Body.transformToByteArray();
  }
  return readFile(localPath(key));
}

export async function deleteObject(key: string): Promise<void> {
  if (s3Configured()) {
    await s3().send(new DeleteObjectCommand({ Bucket: config.s3Bucket, Key: key }));
    return;
  }
  await unlink(localPath(key)).catch(() => undefined);
}

export function storageBackend(): 's3' | 'local' {
  return s3Configured() ? 's3' : 'local';
}
