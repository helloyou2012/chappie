-- 长程任务续驱扫描索引：scheduler 每 5 秒按 status + updated_at 取挂起任务，
-- 部分索引把扫描成本钉在挂起集合内（通常为空）。
CREATE INDEX IF NOT EXISTS agent_task_continuation_idx
  ON agent_task (updated_at)
  WHERE status = 'waiting_continuation';
