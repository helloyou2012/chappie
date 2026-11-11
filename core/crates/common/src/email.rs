//! 验证码邮件投递。
//!
//! - 配置 `RESEND_API_KEY` 后通过 Resend HTTP API 真实发送（域名需在 Resend 验证）；
//! - 未配置时退化为 console sender，仅在日志中输出验证码（本地开发）。
//!
//! 安全约定：Resend 模式下日志不输出验证码；任何模式都不输出 API key。

use serde_json::json;
use std::time::Duration;

const RESEND_ENDPOINT: &str = "https://api.resend.com/emails";

#[derive(Debug, Clone)]
pub enum EmailSender {
    Console,
    Resend { api_key: String, from: String },
}

impl EmailSender {
    pub fn from_config(api_key: &Option<String>, mail_from: &str) -> Self {
        match api_key.as_deref().map(str::trim) {
            Some(key) if !key.is_empty() => EmailSender::Resend {
                api_key: key.to_string(),
                from: mail_from.to_string(),
            },
            _ => EmailSender::Console,
        }
    }

    /// 发送登录验证码。失败只记日志（不影响验证码生成与校验）。
    pub async fn send_code(&self, email: &str, code: &str) {
        match self {
            EmailSender::Console => {
                tracing::info!(email, code, "📧 AUTH_CODE —— 验证码已生成（console sender，仅开发）");
            }
            EmailSender::Resend { api_key, from } => {
                let payload = json!({
                    "from": from,
                    "to": [email],
                    "subject": "Chappie 登录验证码",
                    "text": format!(
                        "你的验证码是 {code}，5 分钟内有效。\n\n如非本人操作，请忽略本邮件。"
                    ),
                });
                let client = match reqwest::Client::builder()
                    .timeout(Duration::from_secs(10))
                    .build()
                {
                    Ok(c) => c,
                    Err(e) => {
                        tracing::warn!(email, error = %e, "验证码邮件发送失败（客户端初始化）");
                        return;
                    }
                };
                match client
                    .post(RESEND_ENDPOINT)
                    .bearer_auth(api_key)
                    .json(&payload)
                    .send()
                    .await
                {
                    Ok(res) if res.status().is_success() => {
                        tracing::info!(email, "📧 AUTH_CODE —— 验证码邮件已发送（resend）");
                    }
                    Ok(res) => {
                        let status = res.status();
                        let body = res.text().await.unwrap_or_default();
                        let brief: String = body.chars().take(200).collect();
                        tracing::warn!(email, %status, body = %brief, "验证码邮件发送失败（resend）");
                    }
                    Err(e) => {
                        tracing::warn!(email, error = %e, "验证码邮件发送失败（resend 网络错误）");
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn console_when_key_missing_or_blank() {
        assert!(matches!(EmailSender::from_config(&None, "x"), EmailSender::Console));
        assert!(matches!(
            EmailSender::from_config(&Some("   ".into()), "x"),
            EmailSender::Console
        ));
    }

    #[test]
    fn resend_when_key_present() {
        match EmailSender::from_config(&Some("re_test".into()), "Chappie <no-reply@chappie.run>") {
            EmailSender::Resend { api_key, from } => {
                assert_eq!(api_key, "re_test");
                assert_eq!(from, "Chappie <no-reply@chappie.run>");
            }
            _ => panic!("应使用 Resend sender"),
        }
    }
}
