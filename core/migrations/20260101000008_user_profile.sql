-- 用户职位/部门：供分身判断群聊中是否需要替主人接话
ALTER TABLE "user" ADD COLUMN job_role TEXT NOT NULL DEFAULT '';
ALTER TABLE "user" ADD COLUMN department TEXT NOT NULL DEFAULT '';
