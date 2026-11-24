/** ICS 解析：单次事件 + 简单 RRULE 展开。 */
import { describe, expect, test } from 'bun:test';
import dayjs from 'dayjs';
import { parseIcsToItems } from '../src/tools/calendar-ics';

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Chappie Test//EN
BEGIN:VEVENT
UID:single-1
DTSTAMP:20261120T000000Z
DTSTART:20261125T100000Z
DTEND:20261125T110000Z
SUMMARY:Team Meeting
END:VEVENT
BEGIN:VEVENT
UID:rrule-1
DTSTAMP:20261120T000000Z
DTSTART:20261124T090000Z
DTEND:20261124T093000Z
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:Standup
END:VEVENT
END:VCALENDAR`;

describe('parseIcsToItems', () => {
  test('解析单次事件并展开 RRULE', () => {
    const now = dayjs('2026-11-24T00:00:00');
    const items = parseIcsToItems(ICS, 'src1', now);
    expect(items.filter((x) => x.title === 'Standup')).toHaveLength(3);
    expect(items.filter((x) => x.title === 'Team Meeting')).toHaveLength(1);
    expect(items.every((x) => x.id?.startsWith('ics_src1_'))).toBe(true);
    expect(items.every((x) => x.status === 'confirmed')).toBe(true);
  });

  test('窗口外的事件被忽略', () => {
    const now = dayjs('2027-06-01T00:00:00');
    const items = parseIcsToItems(ICS, 'src1', now);
    expect(items).toHaveLength(0);
  });
});
