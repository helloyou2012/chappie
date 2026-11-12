-- 审批参数指纹：审批即数据、参数不可篡改。
-- 旧行为 NULL 视为 legacy，允许执行并写审计告警；新审批强制校验。
ALTER TABLE approval ADD COLUMN IF NOT EXISTS args_hash TEXT;
