//! 验证码邮件投递。
//!
//! Console：打印日志（开发默认）。
//! Smtp：预留 —— 配置 SMTP_URL 后仍只打印日志，接入 lettre 属生产化工作，
//! 见 README「与设计文档的差距」。

#[derive(Debug, Clone)]
pub enum EmailSender {
    Console,
    Smtp(String),
}

impl EmailSender {
    pub fn from_config(smtp_url: &Option<String>) -> Self {
        match smtp_url {
            Some(url) => EmailSender::Smtp(url.clone()),
            None => EmailSender::Console,
        }
    }

    pub async fn send_code(&self, email: &str, code: &str) {
        match self {
            EmailSender::Console => {
                tracing::info!(email, code, "📧 AUTH_CODE —— 验证码已生成（console sender）");
            }
            EmailSender::Smtp(url) => {
                // TODO(生产): 接入 lettre SMTP 投递；当前仅记录，避免引入重依赖
                tracing::info!(email, code, url, "📧 AUTH_CODE —— SMTP 投递未实现，回退日志输出");
            }
        }
    }
}
