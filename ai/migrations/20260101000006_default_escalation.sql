-- 默认策略不再用分类器的启发式 confidence 触发“转交主人”。
-- 模型置信度仍由 agent-runtime 在生成后判断（低置信度转草稿），
-- 禁区话题与工具风险审批继续生效。
UPDATE policy
SET rule = jsonb_set(rule, '{escalateWhen}', '[]'::jsonb),
    version = version + 1,
    updated_at = now()
WHERE name = '默认策略'
  AND scope_type = 'global'
  AND rule->'escalateWhen' = '["confidence<0.7"]'::jsonb;
