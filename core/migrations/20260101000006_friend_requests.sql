-- 好友申请：发送 → 接受 / 拒绝 / 取消。
-- 接受后在 contact 表建立双向关系。
CREATE TABLE friend_request (
  id           TEXT PRIMARY KEY,
  from_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  to_user_id   TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  message      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','accepted','rejected','cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ,
  CHECK (from_user_id <> to_user_id)
);

-- 同一方向只允许一个待处理申请；反向申请由应用层合并处理。
CREATE UNIQUE INDEX friend_request_pending_directed_uq
  ON friend_request (from_user_id, to_user_id)
  WHERE status = 'pending';
CREATE INDEX friend_request_incoming_pending_idx
  ON friend_request (to_user_id, created_at DESC)
  WHERE status = 'pending';
CREATE INDEX friend_request_outgoing_pending_idx
  ON friend_request (from_user_id, created_at DESC)
  WHERE status = 'pending';
