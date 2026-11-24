import { adminApi, type FileInfo, formatTime } from '@chappie/shared';
import {
  RiDeleteBinLine,
  RiDownloadLine,
  RiFileTextLine,
  RiLoader4Line,
  RiUploadLine,
} from '@remixicon/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';

const MAX_BYTES = 20 * 1024 * 1024;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function FilesTab() {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.listFiles();
      setFiles(res.files);
    } catch (e) {
      toast.error('加载文件失败', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error('文件过大', '单个文件最大 20MB');
      return;
    }
    setUploading(true);
    try {
      await adminApi.uploadFile(file, file.name);
      toast.success('上传成功', `${file.name} 可供分身读取`);
      await load();
    } catch (e) {
      toast.error('上传失败', e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const download = async (file: FileInfo) => {
    setBusyId(file.id);
    try {
      const blob = await adminApi.downloadFile(file.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('下载失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (file: FileInfo) => {
    if (!window.confirm(`删除「${file.name}」？此操作不可恢复。`)) return;
    setBusyId(file.id);
    try {
      await adminApi.deleteFile(file.id);
      toast.success('已删除', file.name);
      setFiles((prev) => prev.filter((f) => f.id !== file.id));
    } catch (e) {
      toast.error('删除失败', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>文件</CardTitle>
        <CardDescription>
          上传文本或 PDF 后可让分身读取（如「读一下 upload-test.txt 并总结」）。 文件存储在 S3
          或本地目录，仅你自己可见。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          ref={inputRef}
          type="file"
          accept=".txt,.md,.json,.csv,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void upload(file);
          }}
        />
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? (
              <RiLoader4Line className="size-3.5 animate-spin" />
            ) : (
              <RiUploadLine className="size-3.5" />
            )}
            上传文件
          </Button>
          <span className="text-[11px] text-ink-quaternary">
            支持 txt / md / json / csv / pdf，最大 20MB
          </span>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-[12px] text-ink-tertiary">
            <RiLoader4Line className="size-3.5 animate-spin" />
            加载中…
          </div>
        ) : files.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-ink-tertiary">
            还没有文件，上传一份让分身读取吧。
          </div>
        ) : (
          <div className="divide-y divide-line rounded-md border border-line">
            {files.map((file) => (
              <div key={file.id} className="flex items-center gap-3 px-3 py-2.5">
                <RiFileTextLine className="size-4 shrink-0 text-ink-tertiary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink">{file.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-tertiary">
                    <span>{formatBytes(file.size)}</span>
                    <Badge variant="muted" className="px-1 py-0 text-[9px]">
                      {file.mime.split(';')[0]}
                    </Badge>
                    <span>{formatTime(file.createdAt)}</span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="下载"
                  disabled={busyId === file.id}
                  onClick={() => void download(file)}
                >
                  <RiDownloadLine className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="删除"
                  disabled={busyId === file.id}
                  onClick={() => void remove(file)}
                >
                  <RiDeleteBinLine className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
