//! 时间工具：统一输出毫秒精度 UTC ISO-8601（与契约 z.string() 对齐）。

use chrono::{DateTime, SecondsFormat, Utc};

pub fn now() -> DateTime<Utc> {
    Utc::now()
}

pub fn iso(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn now_iso() -> String {
    iso(now())
}

/// 临时档位到期时刻
pub fn hours_from_now(hours: i64) -> String {
    iso(now() + chrono::Duration::hours(hours))
}
