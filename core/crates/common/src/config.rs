//! 环境变量配置（从仓库根目录 .env 加载，见 im-core main）。

use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub redis_url: String,
    /// Rust ↔ Bun 内部 API 共享密钥
    pub internal_token: String,
    pub gateway_port: u16,
    pub internal_port: u16,
    /// dev 模式：验证码在响应体与日志中直接返回
    pub auth_code_dev_echo: bool,
    pub auth_code_ttl_seconds: u64,
    pub smtp_url: Option<String>,
    /// AI 对 AI 最大跳数（防互聊死循环，设计方案 §29.6）
    pub max_hop_count: u32,
}

fn var(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

fn var_opt(key: &str) -> Option<String> {
    env::var(key).ok().filter(|v| !v.trim().is_empty())
}

fn var_bool(key: &str, default: bool) -> bool {
    env::var(key)
        .ok()
        .map(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(default)
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            database_url: var("DATABASE_URL", "postgres://chappie:chappie@127.0.0.1:5432/chappie"),
            redis_url: var("REDIS_URL", "redis://127.0.0.1:6379"),
            internal_token: var("INTERNAL_TOKEN", "dev-internal-token-change-me"),
            gateway_port: var("GATEWAY_PORT", "7000").parse().unwrap_or(7000),
            internal_port: var("INTERNAL_PORT", "7001").parse().unwrap_or(7001),
            auth_code_dev_echo: var_bool("AUTH_CODE_DEV_ECHO", true),
            auth_code_ttl_seconds: var("AUTH_CODE_TTL_SECONDS", "300").parse().unwrap_or(300),
            smtp_url: var_opt("SMTP_URL"),
            max_hop_count: var("MAX_HOP_COUNT", "3").parse().unwrap_or(3),
        }
    }
}
