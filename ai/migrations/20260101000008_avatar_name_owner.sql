-- 分身名称固定跟随主人用户名；历史数据统一回填。
UPDATE avatar a
SET name = u.name,
    version = a.version + 1
FROM "user" u
WHERE a.owner_id = u.id
  AND a.name IS DISTINCT FROM u.name;
