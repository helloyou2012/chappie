-- 紧急穿透：家人/老板等联系人可无视静默/筛选提醒主人，或直接强制真人接待。
ALTER TABLE contact ADD COLUMN always_notify BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contact ADD COLUMN force_human BOOLEAN NOT NULL DEFAULT FALSE;
