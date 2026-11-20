-- 接待权（Reception / Delegation）：把「应答权」做成可委托、可收回、可审计的授权对象。
-- 设计见 docs/system-design.md「Delegation」与 docs/reception-design.md（如已落地）。

-- 档位来源：区分「用户显式选择」与「继承策略默认」。
ALTER TABLE member
  ADD COLUMN ai_mode_source TEXT NOT NULL DEFAULT 'inherit'
  CHECK (ai_mode_source IN ('explicit','inherit'));

-- 历史数据：非 manual 的档位视为用户显式选择；manual 保持 inherit。
UPDATE member SET ai_mode_source = 'explicit' WHERE ai_mode <> 'manual';

-- 用户时区（用于按本地时间解释接待时段；当前保留字段，解析仍以服务端时间为准）。
ALTER TABLE "user" ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai';

-- 联系人分组标签：用于 contact_group 委托作用域与陌生人策略。
CREATE TABLE contact_tag (
  user_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tag)
);

CREATE TABLE contact_tag_member (
  user_id   TEXT NOT NULL,
  tag       TEXT NOT NULL,
  peer_id   TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, tag, peer_id),
  FOREIGN KEY (user_id, tag) REFERENCES contact_tag(user_id, tag) ON DELETE CASCADE
);
CREATE INDEX contact_tag_member_peer_idx ON contact_tag_member (user_id, peer_id);

-- 委托授权：主人对分身在某作用域内的接待授权。
CREATE TABLE delegation (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  avatar_id   TEXT NOT NULL REFERENCES principal(id),
  scope_type  TEXT NOT NULL CHECK (scope_type IN ('global','contact_group','contact','conversation')),
  scope_id    TEXT,
  state       TEXT NOT NULL CHECK (state IN ('human','avatar','paused')),
  strategy    TEXT NOT NULL CHECK (strategy IN ('summon','assist','full','screen','decline','escalate','silent','off')),
  schedule    JSONB NOT NULL DEFAULT '[]',
  timezone    TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  version     BIGINT NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX delegation_owner_idx ON delegation (owner_id, scope_type) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX delegation_scope_uq ON delegation (owner_id, scope_type, COALESCE(scope_id, ''))
  WHERE revoked_at IS NULL;

-- 每个会话的接待态投影：发送路径只读这一行，保证授权强校验。
CREATE TABLE conversation_reception (
  conv_id       TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  owner_id      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  state         TEXT NOT NULL CHECK (state IN ('human','avatar','paused')),
  strategy      TEXT NOT NULL CHECK (strategy IN ('summon','assist','full','screen','decline','escalate','silent','off')),
  source        TEXT NOT NULL DEFAULT 'default',
  version       BIGINT NOT NULL DEFAULT 1,
  handoff_until TIMESTAMPTZ,
  until         TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conv_id, owner_id)
);

-- 授权变更审计（append-only；AI 侧 audit_log 另有统一视图）。
CREATE TABLE delegation_event (
  id            BIGSERIAL PRIMARY KEY,
  owner_id      TEXT NOT NULL,
  conv_id       TEXT,
  scope_type    TEXT NOT NULL,
  scope_id      TEXT,
  actor_id      TEXT NOT NULL,
  actor_type    TEXT NOT NULL,
  action        TEXT NOT NULL,
  from_state    TEXT,
  to_state      TEXT,
  from_strategy TEXT,
  to_strategy   TEXT,
  version       BIGINT NOT NULL,
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX delegation_event_owner_idx ON delegation_event (owner_id, created_at DESC);

-- 对端请求真人：限流与待处理状态由 core 持有。
CREATE TABLE human_request (
  id           TEXT PRIMARY KEY,
  conv_id      TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  owner_id     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  requester_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  reason       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','granted','declined','expired')),
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ
);
CREATE INDEX human_request_pending_idx ON human_request (owner_id, conv_id, status);

-- 为现有会话回填默认接待态：manual→human/summon，draft→human/assist，
-- auto→avatar/full，off→human/off。版本从 1 开始。
INSERT INTO conversation_reception (conv_id, owner_id, state, strategy, source, version)
SELECT m.conv_id, m.principal_id,
       CASE m.ai_mode WHEN 'auto' THEN 'avatar' ELSE 'human' END,
       CASE m.ai_mode
         WHEN 'manual' THEN 'summon'
         WHEN 'draft' THEN 'assist'
         WHEN 'auto' THEN 'full'
         ELSE 'off'
       END,
       'default', 1
FROM member m
JOIN principal p ON p.id = m.principal_id
WHERE p.type = 'human'
ON CONFLICT DO NOTHING;
