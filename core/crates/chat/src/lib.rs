//! chat 领域：会话、成员、seq 分配、消息写入（幂等 + outbox 同事务）、
//! 已读、撤回、presence、验证码登录 —— 设计方案 §25.2 核心路径。

pub mod auth;
pub mod conversation;
pub mod events;
pub mod message;
pub mod model;
pub mod presence;
pub mod state;

pub use events::{event_channel, DomainEvent, EventTx};
pub use model::*;
pub use state::{AppState, ConnectionRegistry};
