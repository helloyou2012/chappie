//! WebSocket 连接生命周期 —— 设计方案 §25.3：
//! 首帧鉴权（10s 超时）、25s 客户端心跳 / 60s 空闲断开、
//! 每连接发送队列上限 256（背压超限断开，客户端重连按 seq 补洞）。

use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use im_core_chat::events::DomainEvent;
use im_core_chat::message::SendParams;
use im_core_chat::model::{ClientFrame, ServerFrame};
use im_core_chat::{auth, message, presence, AppState};
use im_core_common::{time, AppError};
use tokio::sync::mpsc;

use crate::rest;

const AUTH_TIMEOUT: Duration = Duration::from_secs(10);
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(60);
const SEND_QUEUE_CAPACITY: usize = 256;

pub async fn ws_handler(State(state): State<AppState>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();

    // ---- 首帧鉴权 ----
    let user_id = match tokio::time::timeout(AUTH_TIMEOUT, receiver.next()).await {
        Ok(Some(Ok(Message::Text(text)))) => match serde_json::from_str::<ClientFrame>(&text) {
            Ok(ClientFrame::Auth {
                token,
                platform,
                device_id,
                app_version,
                capabilities,
            }) => match auth::verify_token(&state.db, &token).await {
                Ok(uid) => {
                    // 端侧能力随鉴权上报：有 deviceId 才落库，缺失时不影响连接
                    if let Some(device_id) = device_id.as_deref() {
                        let _ = auth::register_device(
                            &state.db,
                            &uid,
                            device_id,
                            &platform,
                            None,
                            capabilities.as_ref(),
                            app_version.as_deref(),
                        )
                        .await;
                    }
                    uid
                }
                Err(e) => {
                    send_frame(&mut sender, &ServerFrame::AuthError { message: e.to_string() }).await;
                    return;
                }
            },
            _ => {
                send_frame(&mut sender, &ServerFrame::AuthError { message: "首帧必须是 auth".into() }).await;
                return;
            }
        },
        _ => return,
    };

    let user = match rest::get_user(&state, &user_id).await {
        Ok(u) => u,
        Err(_) => return,
    };
    send_frame(
        &mut sender,
        &ServerFrame::AuthOk {
            user: user.to_api(),
            server_time: time::now_iso(),
            server_epoch: state.epoch.clone(),
        },
    )
    .await;

    // ---- 注册连接 & 上线 ----
    let (tx, mut rx) = mpsc::channel::<String>(SEND_QUEUE_CAPACITY);
    let conn_count = state.connections.register(&user_id, tx.clone());
    presence::set_online(&state.db, &user_id).await;
    if conn_count == 1 {
        if let Ok(related) = message::related_users(&state.db.pg, &user_id).await {
            let _ = state.events.send(DomainEvent::Presence {
                principal_id: user_id.clone(),
                online: true,
                recipients: related,
            });
        }
    }
    tracing::info!(user_id = %user_id, connections = conn_count, "ws connected");

    // ---- 主循环 ----
    let mut last_heartbeat = Instant::now();
    let mut tick = tokio::time::interval(Duration::from_secs(20));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            maybe = receiver.next() => {
                let Some(Ok(msg)) = maybe else { break };
                match msg {
                    Message::Text(text) => {
                        if let Err(e) = handle_client_frame(&state, &user_id, &mut sender, &text, &mut last_heartbeat).await {
                            send_frame(&mut sender, &ServerFrame::Error { code: "error".into(), message: e.to_string() }).await;
                        }
                    }
                    Message::Close(_) => break,
                    _ => {}
                }
            }
            maybe = rx.recv() => {
                match maybe {
                    Some(json) => {
                        if sender.send(Message::Text(json.into())).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
            _ = tick.tick() => {
                if last_heartbeat.elapsed() > HEARTBEAT_TIMEOUT {
                    tracing::info!(user_id = %user_id, "ws heartbeat timeout, closing");
                    break;
                }
                presence::heartbeat(&state.db, &user_id).await;
            }
        }
    }

    // ---- 清理 & 下线 ----
    let remaining = state.connections.unregister(&user_id, &tx);
    if remaining == 0 {
        presence::set_offline(&state.db, &user_id).await;
        if let Ok(related) = message::related_users(&state.db.pg, &user_id).await {
            let _ = state.events.send(DomainEvent::Presence {
                principal_id: user_id.clone(),
                online: false,
                recipients: related,
            });
        }
    }
    tracing::info!(user_id = %user_id, remaining_connections = remaining, "ws disconnected");
}

async fn handle_client_frame(
    state: &AppState,
    user_id: &str,
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    text: &str,
    last_heartbeat: &mut Instant,
) -> Result<(), AppError> {
    let frame: ClientFrame =
        serde_json::from_str(text).map_err(|e| AppError::bad(format!("帧格式错误: {e}")))?;
    match frame {
        ClientFrame::Auth { .. } => Err(AppError::bad("连接已认证，无需重复 auth")),
        ClientFrame::Heartbeat { ts } => {
            *last_heartbeat = Instant::now();
            presence::heartbeat(&state.db, user_id).await;
            send_frame(sender, &ServerFrame::HeartbeatAck { ts }).await;
            Ok(())
        }
        ClientFrame::SendMessage { client_msg_id, conv_id, content, mentions, reply_to } => {
            let ack_client_msg_id = client_msg_id.clone();
            let sender_principal = rest::get_principal(state, user_id).await?;
            let msg = message::send_message(
                &state.db,
                &state.cfg,
                &state.events,
                SendParams {
                    client_msg_id,
                    conv_id,
                    sender: sender_principal,
                    on_behalf_of: None,
                    content,
                    mentions,
                    reply_to,
                    ai_meta: None,
                },
            )
            .await?;
            send_frame(
                sender,
                &ServerFrame::MessageAcked {
                    client_msg_id: ack_client_msg_id,
                    msg_id: msg.msg_id.clone(),
                    seq: msg.seq,
                    server_time: msg.created_at.clone(),
                },
            )
            .await;
            Ok(())
        }
        ClientFrame::Typing { conv_id } => {
            message::ensure_member(&state.db.pg, &conv_id, user_id).await?;
            presence::set_typing(&state.db, &conv_id, user_id).await;
            let recipients = message::conversation_recipients(&state.db.pg, &conv_id)
                .await?
                .into_iter()
                .filter(|r| r != user_id)
                .collect();
            let until_ts = (time::now() + chrono::Duration::seconds(5)).timestamp_millis();
            let _ = state.events.send(DomainEvent::Typing {
                conv_id,
                principal_id: user_id.to_string(),
                until_ts,
                recipients,
            });
            Ok(())
        }
        ClientFrame::MarkRead { conv_id, seq } => {
            message::mark_read(&state.db, &state.events, user_id, &conv_id, seq).await?;
            Ok(())
        }
        ClientFrame::RecallMessage { msg_id } => {
            message::recall_message(&state.db, &state.events, user_id, &msg_id).await?;
            Ok(())
        }
        ClientFrame::PullMessages { conv_id, from_seq, limit } => {
            message::ensure_member(&state.db.pg, &conv_id, user_id).await?;
            let messages =
                message::pull_range(&state.db.pg, &conv_id, from_seq, limit.clamp(1, 200)).await?;
            send_frame(
                sender,
                &ServerFrame::MessagesBatch { conv_id, messages, has_more: false },
            )
            .await;
            Ok(())
        }
    }
}

async fn send_frame(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    frame: &ServerFrame,
) {
    if let Ok(json) = serde_json::to_string(frame) {
        let _ = sender.send(Message::Text(json.into())).await;
    }
}
