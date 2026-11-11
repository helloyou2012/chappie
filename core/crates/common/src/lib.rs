//! im-core 公共设施：配置、错误模型、ID 生成、验证码邮件 sender。

pub mod config;
pub mod email;
pub mod error;
pub mod ids;
pub mod time;

pub use config::Config;
pub use email::EmailSender;
pub use error::{AppError, AppResult};
