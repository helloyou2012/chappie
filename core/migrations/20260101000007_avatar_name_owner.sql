-- 分身名称固定跟随主人用户名；历史数据统一回填。
UPDATE principal p
SET name = u.name
FROM "user" u
WHERE p.type = 'avatar'
  AND p.owner_id = u.id
  AND p.name IS DISTINCT FROM u.name;
