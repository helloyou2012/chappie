//! 内部 API（替代 gRPC 的 HTTP JSON 方案，见计划「关键决策」）。
//!
//! 仅监听 127.0.0.1，X-Internal-Token 共享密钥鉴权，X-Trace-Id 透传。
//! 接口对应设计方案 §25.5 六接口 + 账号生命周期所需的补充接口。

use axum::extract::State;
use axum::http::HeaderMap;
use axum::middleware::{self, Next};
use axum::routing::post;
use axum::{Json, Router};
use im_core_chat::message::SendParams;
use im_core_chat::{conversation, message, presence, AppState, DomainEvent};
use im_core_common::{ids, time, AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::json;

pub fn router(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/internal/v1/verify-token", post(verify_token))
        .route("/internal/v1/send-message", post(send_message))
        .route("/internal/v1/recall-message", post(recall_message))
        .route("/internal/v1/get-context", post(get_context))
        .route("/internal/v1/get-reception", post(get_reception))
        .route("/internal/v1/set-reception", post(set_reception))
        .route("/internal/v1/resolve-human-request", post(resolve_human_request))
        .route("/internal/v1/get-presence", post(get_presence))
        .route("/internal/v1/get-devices", post(get_devices))
        .route("/internal/v1/typing", post(typing))
        .route("/internal/v1/push-card", post(push_card))
        .route("/internal/v1/update-card", post(update_card))
        .route("/internal/v1/update-stream-text", post(update_stream_text))
        .route("/internal/v1/finalize-stream-message", post(finalize_stream_message))
        .route("/internal/v1/freeze-avatar", post(freeze_avatar))
        .route("/internal/v1/update-avatar-name", post(update_avatar_name))
        .route("/internal/v1/create-avatar", post(create_avatar))
        .route("/internal/v1/create-conversation", post(create_conversation))
        .route("/internal/v1/ensure-direct", post(ensure_direct))
        .layer(middleware::from_fn_with_state(state, require_internal_token))
}

async fn require_internal_token(
    State(state): State<AppState>,
    headers: HeaderMap,
    req: axum::extract::Request,
    next: Next,
) -> AppResult<axum::response::Response> {
    let token = headers
        .get("x-internal-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if token != state.cfg.internal_token {
        return Err(AppError::unauthorized("内部令牌无效"));
    }
    Ok(next.run(req).await)
}

fn trace_id(headers: &HeaderMap) -> String {
    headers
        .get("x-trace-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string()
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifyTokenReq {
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UserIdResp {
    user_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendMessageReq {
    client_msg_id: String,
    conv_id: String,
    sender_id: String,
    on_behalf_of: Option<String>,
    content: im_core_chat::Content,
    #[serde(default)]
    mentions: Vec<String>,
    #[serde(default)]
    reply_to: Option<String>,
    #[serde(default)]
    ai_meta: Option<im_core_chat::AiMeta>,
    #[serde(default)]
    authority_version: i64,
    #[serde(default)]
    via: Option<String>,
    /// 流式消息：先只对主人可见，通过 update-stream-text / finalize-stream-message 推进
    #[serde(default)]
    streaming: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStreamTextReq {
    msg_id: String,
    text: String,
    /// 思考内容（可选；仅主人可见）
    #[serde(default)]
    thinking: Option<String>,
    /// 工具活动时间线（可选；仅主人可见）
    #[serde(default)]
    activity: Option<Vec<im_core_chat::ActivityItem>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FinalizeStreamMessageReq {
    msg_id: String,
    /// 缺省 = 保留当前流式内容（取消/中断等场景）
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    ai_meta: Option<im_core_chat::AiMeta>,
    /// true = 对外可见（写入 message.created 并广播所有成员）；false = 保留 ownerOnly
    #[serde(default)]
    visible: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecallMessageReq {
    msg_id: String,
    actor_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetContextReq {
    conv_id: String,
    /// 分身主人；传入时返回该主人的接待态
    #[serde(default)]
    owner_id: Option<String>,
    #[serde(default = "default_ctx_limit")]
    limit: i64,
}
fn default_ctx_limit() -> i64 {
    20
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GetContextResp {
    messages: Vec<im_core_chat::Message>,
    members: Vec<im_core_chat::MemberView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reception: Option<im_core_chat::ReceptionView>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetReceptionReq {
    owner_id: String,
    conv_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetReceptionReq {
    owner_id: String,
    conv_id: String,
    state: String,
    strategy: String,
    #[serde(default)]
    until: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveHumanRequestReq {
    owner_id: String,
    request_id: String,
    approve: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetPresenceReq {
    user_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PushCardReq {
    recipient_user_id: String,
    card: im_core_chat::CardPayload,
    /// 卡片所在会话；缺省为该用户的「我的分身」系统会话
    target_conv_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PushCardResp {
    msg_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCardReq {
    msg_id: String,
    card: im_core_chat::CardPayload,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FreezeAvatarReq {
    avatar_id: String,
    frozen: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateAvatarNameReq {
    avatar_id: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAvatarReq {
    owner_id: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateAvatarResp {
    avatar_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateConversationReq {
    #[serde(rename = "type")]
    conv_type: String,
    member_principal_ids: Vec<String>,
    title: Option<String>,
    system_tag: Option<String>,
}

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------

async fn verify_token(
    State(state): State<AppState>,
    Json(req): Json<VerifyTokenReq>,
) -> AppResult<Json<UserIdResp>> {
    let user_id = im_core_chat::auth::verify_token(&state.db, &req.token).await?;
    Ok(Json(UserIdResp { user_id }))
}

async fn send_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<SendMessageReq>,
) -> AppResult<Json<im_core_chat::Message>> {
    let sender = get_principal(&state, &req.sender_id).await?;
    let msg = message::send_message(
        &state.db,
        &state.cfg,
        &state.events,
        SendParams {
            client_msg_id: req.client_msg_id,
            conv_id: req.conv_id,
            sender,
            on_behalf_of: req.on_behalf_of,
            content: req.content,
            mentions: req.mentions,
            reply_to: req.reply_to,
            ai_meta: req.ai_meta,
            authority_version: req.authority_version,
            via: req.via,
            streaming: req.streaming,
        },
    )
    .await?;
    tracing::info!(trace_id = %trace_id(&headers), msg_id = %msg.msg_id, "internal send-message ok");
    Ok(Json(msg))
}

async fn recall_message(
    State(state): State<AppState>,
    Json(req): Json<RecallMessageReq>,
) -> AppResult<Json<serde_json::Value>> {
    message::recall_message(&state.db, &state.events, &req.actor_id, &req.msg_id).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn get_context(
    State(state): State<AppState>,
    Json(req): Json<GetContextReq>,
) -> AppResult<Json<GetContextResp>> {
    // AI 内部读上下文：以主人为视角，只返回该主人自己的 ownerOnly（流式/草稿）消息，
    // 不把群里其他分身尚未发送的内容暴露给本分身。
    let (messages, _) = message::history(
        &state.db.pg,
        &req.conv_id,
        None,
        req.limit,
        req.owner_id.as_deref(),
    )
    .await?;
    let members = conversation::get_members(&state.db, &req.conv_id).await?;
    let reception = match req.owner_id.as_deref() {
        Some(owner) => Some(
            im_core_chat::reception::get_reception(&state.db.pg, &req.conv_id, owner).await?,
        ),
        None => None,
    };
    Ok(Json(GetContextResp { messages, members, reception }))
}

async fn get_reception(
    State(state): State<AppState>,
    Json(req): Json<GetReceptionReq>,
) -> AppResult<Json<im_core_chat::ReceptionView>> {
    Ok(Json(
        im_core_chat::reception::get_reception(&state.db.pg, &req.conv_id, &req.owner_id).await?,
    ))
}

async fn set_reception(
    State(state): State<AppState>,
    Json(req): Json<SetReceptionReq>,
) -> AppResult<Json<im_core_chat::ReceptionView>> {
    let until = req
        .until
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&chrono::Utc));
    let view = im_core_chat::reception::set_conversation_reception(
        &state.db,
        &state.events,
        &req.owner_id,
        &req.conv_id,
        &req.state,
        &req.strategy,
        until,
        "system",
        "system",
        req.reason.as_deref().unwrap_or("外部设置"),
    )
    .await?;
    Ok(Json(view))
}

async fn resolve_human_request(
    State(state): State<AppState>,
    Json(req): Json<ResolveHumanRequestReq>,
) -> AppResult<Json<serde_json::Value>> {
    im_core_chat::reception::resolve_human_request(
        &state.db,
        &state.events,
        &req.owner_id,
        &req.request_id,
        req.approve,
    )
    .await?;
    Ok(Json(json!({ "ok": true })))
}

async fn get_presence(
    State(state): State<AppState>,
    Json(req): Json<GetPresenceReq>,
) -> AppResult<Json<serde_json::Value>> {
    let presences = presence::get_presences(&state.db, &req.user_ids).await?;
    Ok(Json(serde_json::to_value(presences)?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetDevicesReq {
    user_id: String,
}

/// 查询用户设备与端侧能力清单（Agent 决定可用端侧动作）
async fn get_devices(
    State(state): State<AppState>,
    Json(req): Json<GetDevicesReq>,
) -> AppResult<Json<serde_json::Value>> {
    let devices = im_core_chat::auth::list_devices(&state.db, &req.user_id).await?;
    Ok(Json(json!({ "devices": devices })))
}

/// AI 分身在工作期间向会话广播「正在输入」状态（客户端据此把发送按钮切换为停止/接管）。
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypingReq {
    conv_id: String,
    principal_id: String,
    #[serde(default)]
    ttl_ms: Option<i64>,
}

async fn typing(
    State(state): State<AppState>,
    Json(req): Json<TypingReq>,
) -> AppResult<Json<serde_json::Value>> {
    let member: Option<(String,)> = sqlx::query_as(
        "SELECT principal_id FROM member WHERE conv_id = $1 AND principal_id = $2",
    )
    .bind(&req.conv_id)
    .bind(&req.principal_id)
    .fetch_optional(&state.db.pg)
    .await?;
    if member.is_none() {
        return Err(AppError::not_found("主体不是该会话成员"));
    }
    let ttl = req.ttl_ms.unwrap_or(20_000).clamp(0, 60_000);
    let until_ts = time::now().timestamp_millis() + ttl;
    let mut recipients = message::conversation_recipients(&state.db.pg, &req.conv_id).await?;
    recipients.retain(|r| r != &req.principal_id);
    let _ = state.events.send(DomainEvent::Typing {
        conv_id: req.conv_id,
        principal_id: req.principal_id,
        until_ts,
        recipients,
    });
    Ok(Json(json!({ "ok": true })))
}

/// 向用户推送卡片（草稿/确认/任务/转交/日报）—— 设计方案 §25.5 PushCard。
/// 卡片是消息：落在该用户的「我的分身」会话，保证仅主人可见。
async fn push_card(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<PushCardReq>,
) -> AppResult<Json<PushCardResp>> {
    let conv_id = match req.target_conv_id {
        Some(c) => c,
        None => avatar_self_conv(&state, &req.recipient_user_id).await?,
    };
    // 卡片发送者 = 该会话中的 avatar 分身，on_behalf_of = 主人
    let avatar_principal: Option<(String, Option<String>, String, String)> = sqlx_query_avatar(
        &state, &conv_id,
    )
    .await?;
    let sender = avatar_principal.ok_or_else(|| AppError::internal_msg("分身会话中未找到分身主体"))?;

    let msg = message::send_message(
        &state.db,
        &state.cfg,
        &state.events,
        SendParams {
            client_msg_id: ids::new_id("cardcm"),
            conv_id,
            sender: im_core_chat::Principal {
                id: sender.0,
                principal_type: "avatar".into(),
                owner_id: sender.1,
                name: sender.2,
                status: sender.3,
            },
            on_behalf_of: Some(req.recipient_user_id.clone()),
            content: im_core_chat::Content::Card { schema_version: 1, card: req.card },
            mentions: vec![],
            reply_to: None,
            ai_meta: None,
            authority_version: 0,
            via: Some("internal_card".into()),
            streaming: false,
        },
    )
    .await?;
    tracing::info!(trace_id = %trace_id(&headers), msg_id = %msg.msg_id, "internal push-card ok");
    Ok(Json(PushCardResp { msg_id: msg.msg_id }))
}

async fn update_card(
    State(state): State<AppState>,
    Json(req): Json<UpdateCardReq>,
) -> AppResult<Json<im_core_chat::Message>> {
    let msg = message::update_card_content(&state.db, &state.events, &req.msg_id, req.card).await?;
    Ok(Json(msg))
}

/// 流式增量：用 AI 累积的完整文本替换内容，仅推给主人（持久化，重连可恢复）。
async fn update_stream_text(
    State(state): State<AppState>,
    Json(req): Json<UpdateStreamTextReq>,
) -> AppResult<Json<im_core_chat::Message>> {
    let msg = message::update_stream_text(
        &state.db,
        &state.events,
        &req.msg_id,
        &req.text,
        req.thinking.as_deref(),
        req.activity,
    )
    .await?;
    Ok(Json(msg))
}

/// 流式定稿：visible=true 才对外可见并进入 AI 事件链路；否则保留 ownerOnly。
async fn finalize_stream_message(
    State(state): State<AppState>,
    Json(req): Json<FinalizeStreamMessageReq>,
) -> AppResult<Json<im_core_chat::Message>> {
    let msg = message::finalize_stream_message(
        &state.db,
        &state.events,
        &req.msg_id,
        req.text.as_deref(),
        req.ai_meta,
        req.visible,
    )
    .await?;
    Ok(Json(msg))
}

async fn freeze_avatar(
    State(state): State<AppState>,
    Json(req): Json<FreezeAvatarReq>,
) -> AppResult<Json<serde_json::Value>> {
    let status = if req.frozen { "frozen" } else { "active" };
    let res = sqlx::query("UPDATE principal SET status = $2 WHERE id = $1 AND type = 'avatar'")
        .bind(&req.avatar_id)
        .bind(status)
        .execute(&state.db.pg)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found("分身不存在"));
    }
    tracing::warn!(avatar_id = %req.avatar_id, status, "avatar freeze status changed");
    Ok(Json(json!({ "ok": true, "status": status })))
}

/// 分身改名：同步更新 core 的 principal.name，并通知共同会话中的真人刷新。
async fn update_avatar_name(
    State(state): State<AppState>,
    Json(req): Json<UpdateAvatarNameReq>,
) -> AppResult<Json<serde_json::Value>> {
    conversation::update_avatar_name(&state.db, &state.events, &req.avatar_id, &req.name)
        .await?;
    tracing::info!(avatar_id = %req.avatar_id, name = %req.name, "avatar principal name updated");
    Ok(Json(json!({ "ok": true })))
}

/// Bun 处理 user.created 时调用：创建 avatar 的 principal 行（principal 表单写者归 Rust）
async fn create_avatar(
    State(state): State<AppState>,
    Json(req): Json<CreateAvatarReq>,
) -> AppResult<Json<CreateAvatarResp>> {
    let avatar_id = ids::new_avatar_id();
    sqlx::query(
        "INSERT INTO principal (id, type, owner_id, name) VALUES ($1, 'avatar', $2, $3)",
    )
    .bind(&avatar_id)
    .bind(&req.owner_id)
    .bind(&req.name)
    .execute(&state.db.pg)
    .await?;
    Ok(Json(CreateAvatarResp { avatar_id }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnsureDirectReq {
    user_id: String,
    peer_id: String,
}

/// 幂等获取/创建两人单聊，并确保双方分身都是成员（AI 工具代发前置）。
async fn ensure_direct(
    State(state): State<AppState>,
    Json(req): Json<EnsureDirectReq>,
) -> AppResult<Json<serde_json::Value>> {
    let conv_id = conversation::create_direct(&state.db, &state.events, &req.user_id, &req.peer_id)
        .await?;
    Ok(Json(json!({ "convId": conv_id })))
}

async fn create_conversation(
    State(state): State<AppState>,
    Json(req): Json<CreateConversationReq>,
) -> AppResult<Json<serde_json::Value>> {
    let conv_id = ids::new_conv_id();
    sqlx::query("INSERT INTO conversation (id, type, title, system_tag) VALUES ($1, $2, $3, $4)")
        .bind(&conv_id)
        .bind(&req.conv_type)
        .bind(&req.title)
        .bind(&req.system_tag)
        .execute(&state.db.pg)
        .await?;
    for pid in &req.member_principal_ids {
        sqlx::query("INSERT INTO member (conv_id, principal_id, role) VALUES ($1, $2, 'member')")
            .bind(&conv_id)
            .bind(pid)
            .execute(&state.db.pg)
            .await?;
    }
    Ok(Json(json!({ "convId": conv_id })))
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async fn get_principal(state: &AppState, id: &str) -> AppResult<im_core_chat::Principal> {
    let p: Option<im_core_chat::Principal> =
        sqlx::query_as("SELECT * FROM principal WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.db.pg)
            .await?;
    p.ok_or_else(|| AppError::not_found(format!("主体不存在: {id}")))
}

async fn avatar_self_conv(state: &AppState, user_id: &str) -> AppResult<String> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT c.id FROM conversation c
         JOIN member m ON m.conv_id = c.id
         WHERE c.system_tag = 'avatar_self' AND m.principal_id = $1
         LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(&state.db.pg)
    .await?;
    row.map(|r| r.0)
        .ok_or_else(|| AppError::internal_msg(format!("用户 {user_id} 的分身会话尚未创建（avatar 未初始化）")))
}

async fn sqlx_query_avatar(
    state: &AppState,
    conv_id: &str,
) -> AppResult<Option<(String, Option<String>, String, String)>> {
    let row: Option<(String, Option<String>, String, String)> = sqlx::query_as(
        "SELECT p.id, p.owner_id, p.name, p.status
         FROM member m JOIN principal p ON p.id = m.principal_id
         WHERE m.conv_id = $1 AND p.type = 'avatar'
         LIMIT 1",
    )
    .bind(conv_id)
    .fetch_optional(&state.db.pg)
    .await?;
    Ok(row)
}
