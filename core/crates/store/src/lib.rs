//! 存储层：PostgreSQL（唯一事实来源）+ Redis（加速层，全部带 TTL —— 设计方案 §37）。
//!
//! DAO 直接内聚在各领域模块（chat crate）中；本 crate 只负责连接、迁移与
//! 少量跨模块的 Redis 工具。SQL 一律使用 sqlx 运行时 API（非宏），
//! 构建期不需要 DATABASE_URL。

use anyhow::Context;
use im_core_common::Config;
use redis::aio::ConnectionManager;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;

#[derive(Clone)]
pub struct Db {
    pub pg: PgPool,
    pub redis: ConnectionManager,
}

impl Db {
    pub async fn connect(cfg: &Config) -> anyhow::Result<Self> {
        let pg = PgPoolOptions::new()
            .max_connections(16)
            .acquire_timeout(std::time::Duration::from_secs(10))
            .connect(&cfg.database_url)
            .await
            .context("连接 PostgreSQL 失败（请先运行 pnpm compose:up）")?;

        let redis_client = redis::Client::open(cfg.redis_url.as_str())?;
        let redis = ConnectionManager::new(redis_client)
            .await
            .context("连接 Redis 失败（请先运行 pnpm compose:up）")?;

        // 连接串含密码，日志中必须脱敏（避免凭据进入 journald/日志采集）
        tracing::info!(
            pg = %redact_url(&cfg.database_url),
            redis = %redact_url(&cfg.redis_url),
            "storage connected"
        );
        Ok(Self { pg, redis })
    }

    /// 迁移随二进制嵌入（sqlx::migrate!），启动时自动执行、幂等。
    pub async fn migrate(&self) -> anyhow::Result<()> {
        sqlx::migrate!("../../migrations").run(&self.pg).await?;
        tracing::info!("core migrations up to date");
        Ok(())
    }
}

/// 连接串脱敏：`scheme://user:pass@host` → `scheme://***@host`。
fn redact_url(raw: &str) -> String {
    match raw.split_once("://") {
        Some((scheme, rest)) => match rest.split_once('@') {
            Some((_credentials, host)) => format!("{scheme}://***@{host}"),
            None => raw.to_string(),
        },
        None => raw.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::redact_url;

    #[test]
    fn redacts_credentials_in_urls() {
        assert_eq!(
            redact_url("postgres://chappie:secret@127.0.0.1:5432/chappie"),
            "postgres://***@127.0.0.1:5432/chappie"
        );
        assert_eq!(
            redact_url("redis://:secret@127.0.0.1:6379"),
            "redis://***@127.0.0.1:6379"
        );
        assert_eq!(redact_url("redis://127.0.0.1:6379"), "redis://127.0.0.1:6379");
    }
}

// ---------------------------------------------------------------------------
// Redis 工具：所有 key 必须带 TTL（设计方案 §37.2 使用原则）
// ---------------------------------------------------------------------------

pub mod redis_keys {
    pub const PRESENCE: fn(&str) -> String = |uid| format!("core:presence:{uid}");
    pub const TYPING: fn(&str, &str) -> String =
        |conv, uid| format!("core:typing:{conv}:{uid}");
    pub const AUTH_CODE: fn(&str) -> String = |email| format!("core:code:{email}");
    pub const AUTH_CODE_RL: fn(&str) -> String = |email| format!("core:rl:code:{email}");
    pub const AUTH_TOKEN: fn(&str) -> String = |token| format!("core:auth:{token}");
    /// 跨节点事件总线（不持久；漏推由客户端按 seq 补洞）
    pub const BUS: &str = "core:bus";
}
