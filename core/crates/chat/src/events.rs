//! 领域事件（进程内 fanout + Redis Pub/Sub 跨节点广播 —— 设计方案 §25.3/§37.1）。

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

use crate::model::Message;

/// 进程内 fanout 事件；多节点经 Redis Pub/Sub（core:bus）广播，JSON 序列化传输。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum DomainEvent {
    MessageCreated {
        message: Message,
        /// 在线推送目标（human 成员 principal id；avatar 不建立 WS 连接）
        recipients: Vec<String>,
    },
    MessageRecalled {
        conv_id: String,
        msg_id: String,
        recipients: Vec<String>,
    },
    MessageUpdated {
        message: Message,
        recipients: Vec<String>,
    },
    Typing {
        conv_id: String,
        principal_id: String,
        until_ts: i64,
        recipients: Vec<String>,
    },
    Presence {
        principal_id: String,
        online: bool,
        recipients: Vec<String>,
    },
    ReadSync {
        conv_id: String,
        principal_id: String,
        last_read_seq: i64,
        recipients: Vec<String>,
    },
    ConversationsChanged {
        recipients: Vec<String>,
    },
}

pub type EventTx = broadcast::Sender<DomainEvent>;

pub fn event_channel() -> (EventTx, broadcast::Receiver<DomainEvent>) {
    broadcast::channel(1024)
}
