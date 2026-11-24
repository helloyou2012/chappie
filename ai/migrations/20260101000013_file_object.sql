-- 文件对象元数据：实际内容落在 S3（配置后）或本地目录（FILE_LOCAL_DIR）。
CREATE TABLE file_object (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL DEFAULT 'application/octet-stream',
  size        INT NOT NULL DEFAULT 0,
  storage_key TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX file_object_owner_idx ON file_object (owner_id, created_at DESC);
