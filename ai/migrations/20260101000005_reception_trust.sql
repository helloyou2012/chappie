-- 冷启动放权：0=观察 1=草稿 2=低风险自动 3=全权。
ALTER TABLE avatar ADD COLUMN trust_level INT NOT NULL DEFAULT 2
  CHECK (trust_level BETWEEN 0 AND 3);
