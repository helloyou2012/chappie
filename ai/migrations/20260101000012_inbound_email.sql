-- 入站邮件：由 /webhooks/inbound-email 写入，供 email.list / email.read 工具检索。
CREATE TABLE inbound_email (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  message_id  TEXT NOT NULL,
  from_addr   TEXT NOT NULL DEFAULT '',
  to_addr     TEXT NOT NULL DEFAULT '',
  subject     TEXT NOT NULL DEFAULT '',
  text_body   TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX inbound_email_message_uq ON inbound_email (message_id);
CREATE INDEX inbound_email_owner_idx ON inbound_email (owner_id, received_at DESC);
