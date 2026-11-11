-- ai-platform 拥有的表（设计方案 §26.2「归 Bun 所有」）。
-- 与 core 迁移分离管理：各自迁移、向前兼容（设计方案 §30.3）。
-- 注：memory_item.embedding 用 REAL[]（应用层余弦）替代 pgvector 的 vector 列 ——
-- 依赖最少原则（README「与设计文档的差距」），接口不变，记忆量级上来后平滑迁移 pgvector。

CREATE TABLE avatar (
  id                TEXT PRIMARY KEY,          -- 与 principal.id 相同（a_xxx，由 core 创建）
  owner_id          TEXT NOT NULL,             -- u_xxx
  name              TEXT NOT NULL,
  persona           TEXT NOT NULL DEFAULT '',
  model_profile     TEXT NOT NULL DEFAULT 'default',
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen')),
  self_conv_id      TEXT,                      -- 「我的分身」会话 id
  daily_budget_usd  NUMERIC(10,4) NOT NULL DEFAULT 1.0,
  version           INT NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_avatar_owner ON avatar (owner_id);

CREATE TABLE policy (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global','contact','contact_group','conversation','schedule')),
  scope_id   TEXT,
  name       TEXT NOT NULL DEFAULT '',
  rule       JSONB NOT NULL,
  priority   INT NOT NULL DEFAULT 0,
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  version    INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_policy_owner ON policy (owner_id, scope_type, scope_id);

CREATE TABLE capability (
  id          TEXT PRIMARY KEY,          -- 如 calendar.read
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  schema      JSONB NOT NULL DEFAULT '{}',
  risk_level  TEXT NOT NULL CHECK (risk_level IN ('L0','L1','L2','L3')),
  provider    TEXT NOT NULL DEFAULT 'builtin',
  version     INT NOT NULL DEFAULT 1
);

CREATE TABLE capability_grant (
  avatar_id    TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  granted      BOOLEAN NOT NULL DEFAULT TRUE,
  constraints  JSONB NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (avatar_id, capability_id)
);

-- 任务状态机：created → planning → [waiting_approval] → running →
-- [waiting_user_input] → completed | failed | cancelled | handed_over | skipped
CREATE TABLE agent_task (
  id               TEXT PRIMARY KEY,
  avatar_id        TEXT NOT NULL,
  owner_id         TEXT NOT NULL,
  trigger_msg_id   TEXT,
  trigger_conv_id  TEXT,
  trigger_kind     TEXT NOT NULL,      -- mention|auto|direct_chat|preview|report|approval_resume
  status           TEXT NOT NULL CHECK (status IN (
                     'created','planning','waiting_approval','running','waiting_user_input',
                     'completed','failed','cancelled','handed_over','skipped')),
  plan             JSONB,
  result           TEXT,
  decision         JSONB,               -- { action, reason, confidence }
  cost_usd         NUMERIC(10,6) NOT NULL DEFAULT 0,
  tokens_used      INT NOT NULL DEFAULT 0,
  trace_id         TEXT,
  error            TEXT,
  context          JSONB,               -- agent 恢复所需上下文快照（approval 续跑用）
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (trigger_msg_id, avatar_id)     -- 幂等（设计方案 §26.3）
);
CREATE INDEX idx_agent_task_avatar_time ON agent_task (avatar_id, created_at DESC);

CREATE TABLE task_step (
  id         BIGSERIAL PRIMARY KEY,
  task_id    TEXT NOT NULL,
  idx        INT NOT NULL,
  type       TEXT NOT NULL,              -- classify|policy|plan|tool|model|guard|send|card
  input      JSONB,
  output     JSONB,
  model      TEXT,
  tokens     INT,
  latency_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_task_step_task ON task_step (task_id, idx);

CREATE TABLE approval (
  id             TEXT PRIMARY KEY,
  task_id        TEXT NOT NULL,
  avatar_id      TEXT NOT NULL,
  approver       TEXT NOT NULL,          -- 主人 user id
  title          TEXT NOT NULL,
  tool_name      TEXT NOT NULL,
  args           JSONB NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL CHECK (status IN ('pending','approved','modified','rejected','expired')),
  modified_args  JSONB,
  card_msg_id    TEXT,
  result         JSONB,                  -- 工具执行结果（批准后回填）
  expires_at     TIMESTAMPTZ NOT NULL,
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_approval_approver ON approval (approver, status, created_at DESC);

-- 审计：append-only + 哈希链防篡改（设计方案 §26.4）
CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  task_id    TEXT,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  params     JSONB,
  result     JSONB,
  risk       TEXT,
  prev_hash  TEXT,
  hash       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memory_item (
  id           TEXT PRIMARY KEY,
  avatar_id    TEXT NOT NULL,
  scope        TEXT NOT NULL CHECK (scope IN ('global','contact')),
  peer_id      TEXT,                    -- scope=contact：跨联系人隔离（设计方案 §9.2）
  type         TEXT NOT NULL CHECK (type IN ('fact','preference','commitment','relationship','procedure','episode')),
  content      TEXT NOT NULL,
  embedding    REAL[],                  -- 哈希伪向量（256 维），应用层余弦
  keywords     TEXT[] NOT NULL DEFAULT '{}',
  sensitivity  TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal','sensitive')),
  confidence   REAL NOT NULL DEFAULT 0.8,
  source_msg_id TEXT,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_memory_scope ON memory_item (avatar_id, scope, peer_id);
CREATE INDEX idx_memory_keywords ON memory_item USING gin (keywords);

CREATE TABLE style_profile (
  avatar_id  TEXT PRIMARY KEY,
  features   JSONB NOT NULL DEFAULT '{}',
  examples   JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feedback (
  id         BIGSERIAL PRIMARY KEY,
  msg_id     TEXT NOT NULL,
  task_id    TEXT,
  actor      TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('like','correct','report','accept','reject')),
  diff       TEXT,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usage_daily (
  avatar_id     TEXT NOT NULL,
  day           DATE NOT NULL,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  requests      INT NOT NULL DEFAULT 0,
  input_tokens  INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(10,6) NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (avatar_id, day, provider, model)
);

CREATE TABLE scheduler_job (
  id          TEXT PRIMARY KEY,
  avatar_id   TEXT NOT NULL,
  kind        TEXT NOT NULL,             -- daily_report | approval_sweep
  schedule    TEXT NOT NULL,            -- 'HH:MM'（本地时区）
  payload     JSONB NOT NULL DEFAULT '{}',
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE daily_report (
  id                TEXT PRIMARY KEY,
  avatar_id         TEXT NOT NULL,
  owner_id          TEXT NOT NULL,
  day               DATE NOT NULL,
  summary           TEXT NOT NULL,
  stats             JSONB NOT NULL DEFAULT '{}',
  pending_decisions JSONB NOT NULL DEFAULT '[]',
  card_msg_id       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (avatar_id, day)
);

-- 内置工具（日历/待办等）的演示数据；生产中这些工具对接真实系统
CREATE TABLE tool_data (
  avatar_id TEXT NOT NULL,
  kind     TEXT NOT NULL,               -- calendar | todo
  data     JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (avatar_id, kind)
);
