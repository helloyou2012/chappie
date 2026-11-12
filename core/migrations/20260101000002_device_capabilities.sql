-- 设备能力清单：端云一体的能力契约
-- 客户端在 WS 鉴权 / REST 注册时上报；云端只读，用于决定可用的端侧动作。
ALTER TABLE device ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE device ADD COLUMN IF NOT EXISTS app_version TEXT;
