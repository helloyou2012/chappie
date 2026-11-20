-- 日程创建改为 L2：先给主人确认卡片，批准后才写入日历。
UPDATE capability
SET risk_level = 'L2',
    description = '创建一条日程提醒（需要主人确认后写入）',
    version = version + 1
WHERE id = 'calendar.create';
