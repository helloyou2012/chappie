-- 日程提醒发生台账（设计方案 §9.3 第一优先级：occurrence 唯一键 + 错过/跳过可见）。
-- 唯一键 (avatar_id, entry_id, start_at)：同一条目同一开始时刻只提醒一次；
-- 日程改期 → start_at 变化 → 生成新的 occurrence。
CREATE TABLE calendar_reminder (
  id         TEXT PRIMARY KEY,
  avatar_id  TEXT NOT NULL,
  owner_id   TEXT NOT NULL,
  entry_id   TEXT NOT NULL,
  title      TEXT NOT NULL,
  start_at   TIMESTAMPTZ NOT NULL,
  remind_at  TIMESTAMPTZ NOT NULL,
  -- pending 由调度扫描即时写入：fired = 已提醒 / missed = 超过时效线丢弃
  status     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX calendar_reminder_occurrence_uq ON calendar_reminder (avatar_id, entry_id, start_at);
CREATE INDEX calendar_reminder_status_idx ON calendar_reminder (status, remind_at);
