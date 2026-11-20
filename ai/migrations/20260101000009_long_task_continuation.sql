-- 长程任务（设计方案 §7.3 异步任务 / §27.4 分段执行）：
--   轮次/时间预算用尽但工作未完成时，任务挂起为 waiting_continuation，
--   checkpoint 保留在 context 中，由 scheduler 的 continuation sweep 延后续驱，
--   受整体时限（AI_LONG_TASK_MAX_S）、最大段数（AI_LONG_TASK_MAX_SEGMENTS）与日预算约束。

ALTER TABLE agent_task DROP CONSTRAINT IF EXISTS agent_task_status_check;
ALTER TABLE agent_task ADD CONSTRAINT agent_task_status_check CHECK (status IN (
  'created','planning','waiting_approval','running','waiting_continuation','waiting_user_input',
  'completed','failed','cancelled','handed_over','skipped'));
