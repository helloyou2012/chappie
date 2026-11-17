-- 联系人关系：取代演示用的全站目录（privacy：用户只看得到自己添加的联系人）。
CREATE TABLE contact (
  user_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  peer_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  alias      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, peer_id)
);

CREATE INDEX contact_peer_idx ON contact (peer_id);
