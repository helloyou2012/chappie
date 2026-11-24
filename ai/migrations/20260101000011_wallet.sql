-- 应用内演示账本（非真实资金）。转账仍走 L2 审批与幂等账本。
CREATE TABLE wallet (
  user_id    TEXT PRIMARY KEY,
  balance    NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE wallet_txn (
  id           TEXT PRIMARY KEY,
  from_user_id TEXT NOT NULL,
  to_user_id   TEXT NOT NULL,
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency     TEXT NOT NULL DEFAULT 'CNY',
  note         TEXT,
  task_id      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 同一任务最多一笔转账：审批续跑/恢复重复执行时直接复用它
CREATE UNIQUE INDEX wallet_txn_task_uq ON wallet_txn (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX wallet_txn_from_idx ON wallet_txn (from_user_id, created_at DESC);
CREATE INDEX wallet_txn_to_idx ON wallet_txn (to_user_id, created_at DESC);
