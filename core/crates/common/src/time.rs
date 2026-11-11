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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::DateTime;

    #[test]
    fn now_iso_is_utc_rfc3339_with_millis() {
        let s = now_iso();
        // 例：2026-01-01T00:00:00.000Z（24 字符）
        assert_eq!(s.len(), 24);
        assert!(s.ends_with('Z'));
        assert!(DateTime::parse_from_rfc3339(&s).is_ok());
    }

    #[test]
    fn hours_from_now_is_in_the_future() {
        let t = DateTime::parse_from_rfc3339(&hours_from_now(2)).unwrap();
        assert!(t.to_utc() > now());
    }

    #[test]
    fn iso_preserves_instant() {
        let t = now();
        let parsed = DateTime::parse_from_rfc3339(&iso(t)).unwrap().to_utc();
        assert_eq!(parsed.timestamp_millis(), t.timestamp_millis());
    }
}
