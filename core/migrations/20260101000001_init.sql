-- im-core 拥有的表（设计方案 §26.2「归 Rust 所有」+ 账号体系）
-- 注：多租户 tenant_id 与 RLS 为企业版预留（设计方案 §26.4），本期单租户不启用。

-- 主体：human / avatar / system（bot、service 预留）
CREATE TABLE principal (
  id       TEXT PRIMARY KEY,
  type     TEXT NOT NULL CHECK (type IN ('human','avatar','system')),
  owner_id TEXT REFERENCES principal(id),
  name     TEXT NOT NULL DEFAULT '',
  status   TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_principal_owner ON principal (owner_id) WHERE type = 'avatar';

CREATE TABLE "user" (
  id         TEXT PRIMARY KEY REFERENCES principal(id),
  email      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversation (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL CHECK (type IN ('direct','group')),
  title      TEXT,
  system_tag TEXT,                 -- avatar_self = 主人↔分身系统会话（控制通道）
  last_seq   BIGINT NOT NULL DEFAULT 0,
  settings   JSONB NOT NULL DEFAULT '{}',
  ai_settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE member (
  conv_id       TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  principal_id  TEXT NOT NULL REFERENCES principal(id),
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  ai_mode       TEXT NOT NULL DEFAULT 'manual' CHECK (ai_mode IN ('manual','draft','auto','off')),
  ai_mode_until TIMESTAMPTZ,
  last_read_seq BIGINT NOT NULL DEFAULT 0,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conv_id, principal_id)
);
CREATE INDEX idx_member_principal ON member (principal_id);

-- 消息表：UNIQUE(conv_id, seq) 保序；UNIQUE(sender_id, client_msg_id) 幂等（设计方案 §25.2）
CREATE TABLE message (
  msg_id       TEXT PRIMARY KEY,
  conv_id      TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  seq          BIGINT NOT NULL,
  sender_id    TEXT NOT NULL REFERENCES principal(id),
  sender_type  TEXT NOT NULL CHECK (sender_type IN ('human','avatar','system')),
  on_behalf_of TEXT REFERENCES principal(id),
  content      JSONB NOT NULL,
  mentions     TEXT[] NOT NULL DEFAULT '{}',
  reply_to     TEXT,
  ai_meta      JSONB,
  client_msg_id TEXT NOT NULL,
  recalled     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (conv_id, seq),
  UNIQUE (sender_id, client_msg_id)
);
CREATE INDEX idx_message_conv_seq ON message (conv_id, seq);
CREATE INDEX idx_message_created_brin ON message USING brin (created_at);

-- outbox：与业务同事务写入的事件表（设计方案 §26.3 消费约定）
CREATE TABLE outbox (
  id         BIGSERIAL PRIMARY KEY,
  topic      TEXT NOT NULL,
  key        TEXT,
  payload    JSONB NOT NULL,
  trace_id   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at  TIMESTAMPTZ,
  locked_by  TEXT,
  attempts   INT NOT NULL DEFAULT 0,
  done_at    TIMESTAMPTZ
);
CREATE INDEX idx_outbox_pending ON outbox (id) WHERE done_at IS NULL;

-- 推送设备（离线推送 APNs/FCM 为预留通道，本期仅登记）
CREATE TABLE device (
  user_id    TEXT NOT NULL REFERENCES "user"(id),
  device_id  TEXT NOT NULL,
  platform   TEXT NOT NULL,
  push_token TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);
