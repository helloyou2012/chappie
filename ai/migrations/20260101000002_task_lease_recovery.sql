-- 任务租约 + 检查点恢复（crash recovery）—— 设计方案 §26.3 时效丢弃 / §27.4 中断恢复 / §37 PG 为事实源
-- 租约模式沿用 outbox.locked_at/locked_by；恢复认领由 scheduler 每 tick 原子执行。

ALTER TABLE agent_task ADD COLUMN locked_by TEXT;
ALTER TABLE agent_task ADD COLUMN lease_until TIMESTAMPTZ;

-- 恢复清扫扫描：只覆盖未终结状态（含 waiting_approval 孤儿），部分索引避免全表扫描
CREATE INDEX idx_agent_task_recovery ON agent_task (lease_until)
  WHERE status IN ('created', 'planning', 'running', 'waiting_approval');

-- 工具幂等账本：完成记录按 (task_id, tool_call_id) 查重，恢复时复用输出
ALTER TABLE task_step ADD COLUMN tool_call_id TEXT;
CREATE UNIQUE INDEX uq_task_step_tool_call ON task_step (task_id, tool_call_id)
  WHERE type = 'tool' AND tool_call_id IS NOT NULL;

-- 恢复路径需要按 task_id 反查审批（原表仅有 approver 维度索引）
CREATE INDEX idx_approval_task ON approval (task_id, status);
