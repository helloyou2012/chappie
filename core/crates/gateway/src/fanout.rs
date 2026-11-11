//! fanout：本地事件分发 + Redis Pub/Sub 跨节点广播（设计方案 §25.4、§37.1 core:bus）。
//!
//! Redis 不可用时本地分发仍然工作（单节点降级）；漏推由客户端按 seq 补洞兜底。

use futures_util::StreamExt;
use im_core_chat::events::DomainEvent;
use im_core_chat::model::ServerFrame;
use im_core_chat::AppState;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct BusMessage {
    origin: String,
    event: DomainEvent,
}

/// 订阅进程内事件：本地分发 + 发布到 Redis bus
pub async fn run_local_fanout(state: AppState) {
    let mut rx = state.events.subscribe();
    loop {
        let Ok(event) = rx.recv().await else { break };
        dispatch(&state, &event);
        if let Ok(json) = serde_json::to_string(&BusMessage {
            origin: state.node_id.clone(),
            event: event.clone(),
        }) {
            let mut conn = state.db.redis.clone();
            let _: Result<(), _> = redis::cmd("PUBLISH")
                .arg(im_core_store::redis_keys::BUS)
                .arg(&json)
                .query_async(&mut conn)
                .await;
        }
    }
}

/// 订阅 Redis bus：远端节点的 events 仅本地分发（不再转发，避免回环）
pub async fn run_redis_bus(state: AppState) -> anyhow::Result<()> {
    let client = redis::Client::open(state.cfg.redis_url.as_str())?;
    let mut pubsub = client.get_async_pubsub().await?;
    pubsub.subscribe(im_core_store::redis_keys::BUS).await?;
    tracing::info!("redis bus subscribed (node={})", state.node_id);
    while let Some(msg) = pubsub.on_message().next().await {
        let Ok(payload) = msg.get_payload::<String>() else { continue };
        let Ok(bus) = serde_json::from_str::<BusMessage>(&payload) else { continue };
        if bus.origin == state.node_id {
            continue;
        }
        dispatch(&state, &bus.event);
    }
    Ok(())
}

fn dispatch(state: &AppState, event: &DomainEvent) {
    match event {
        DomainEvent::MessageCreated { message, recipients } => {
            push(state, recipients, &ServerFrame::MessageCreated { message: message.clone() });
        }
        DomainEvent::MessageRecalled { conv_id, msg_id, recipients } => {
            push(
                state,
                recipients,
                &ServerFrame::MessageRecalled { conv_id: conv_id.clone(), msg_id: msg_id.clone() },
            );
        }
        DomainEvent::MessageUpdated { message, recipients } => {
            push(state, recipients, &ServerFrame::MessageUpdated { message: message.clone() });
        }
        DomainEvent::Typing { conv_id, principal_id, until_ts, recipients } => {
            push(
                state,
                recipients,
                &ServerFrame::Typing {
                    conv_id: conv_id.clone(),
                    principal_id: principal_id.clone(),
                    until_ts: *until_ts,
                },
            );
        }
        DomainEvent::Presence { principal_id, online, recipients } => {
            push(
                state,
                recipients,
                &ServerFrame::Presence { principal_id: principal_id.clone(), online: *online },
            );
        }
        DomainEvent::ReadSync { conv_id, principal_id, last_read_seq, recipients } => {
            push(
                state,
                recipients,
                &ServerFrame::ReadSync {
                    conv_id: conv_id.clone(),
                    principal_id: principal_id.clone(),
                    last_read_seq: *last_read_seq,
                },
            );
        }
        DomainEvent::ConversationsChanged { recipients } => {
            push(state, recipients, &ServerFrame::ConversationsChanged);
        }
    }
}

fn push(state: &AppState, recipients: &[String], frame: &ServerFrame) {
    if recipients.is_empty() {
        return;
    }
    if let Ok(json) = serde_json::to_string(frame) {
        state.connections.send_to_users(recipients, &json);
    }
}
