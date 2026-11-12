//! 对外 REST API（/api/v1/*）—— 契约见 packages/contract/src/rest.ts。

use axum::extract::{Path, Query, State};
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Json, Router};
use im_core_chat::model::{ConversationView, Principal, User};
use im_core_chat::{auth, conversation, message, AppState};
use im_core_common::{AppError, AppResult};
use serde::Deserialize;
use serde_json::json;

/// 认证中间件注入的当前用户
#[derive(Clone)]
pub struct CurrentUser(pub String);

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------

pub fn public_routes() -> Router<AppState> {
    Router::new()
        .route("/api/v1/auth/code/send", post(send_code))
        .route("/api/v1/auth/code/verify", post(verify_code))
        .route("/api/v1/auth/logout", post(logout))
}

pub fn protected_routes(state: AppState) -> Router<AppState> {
    Router::new()
        .route("/api/v1/me", get(me))
        .route("/api/v1/directory", get(directory))
        .route("/api/v1/conversations", get(list_conversations).post(create_conversation))
        .route("/api/v1/conversations/{id}/messages", get(list_messages))
        .route("/api/v1/conversations/{id}/members", get(list_members))
        .route("/api/v1/conversations/{id}/settings", axum::routing::patch(update_settings))
        .route("/api/v1/conversations/{id}/takeover", post(takeover))
        .route("/api/v1/cards/{msg_id}/action", post(card_action))
        .route("/api/v1/messages/{msg_id}/feedback", post(submit_feedback))
        .route("/api/v1/devices", post(register_device))
        .layer(axum::middleware::from_fn_with_state(state, auth_middleware))
}

pub async fn auth_middleware(
    State(state): State<AppState>,
    mut req: axum::extract::Request,
    next: axum::middleware::Next,
) -> AppResult<Response> {
    let token = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| AppError::unauthorized("缺少 Bearer 令牌"))?;
    let user_id = auth::verify_token(&state.db, token).await?;
    req.extensions_mut().insert(CurrentUser(user_id));
    Ok(next.run(req).await)
}

// ---------------------------------------------------------------------------
// 认证
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct SendCodeReq {
    email: String,
}

async fn send_code(State(state): State<AppState>, Json(req): Json<SendCodeReq>) -> AppResult<Json<serde_json::Value>> {
    if !req.email.contains('@') || req.email.len() < 5 {
        return Err(AppError::bad("邮箱格式不正确"));
    }
    let r = auth::send_code(&state.db, &state.cfg, &req.email).await?;
    Ok(Json(json!({ "devCode": r.dev_code, "expiresInSeconds": r.expires_in })))
}

#[derive(Deserialize)]
pub struct VerifyCodeReq {
    email: String,
    code: String,
}

async fn verify_code(State(state): State<AppState>, Json(req): Json<VerifyCodeReq>) -> AppResult<Json<serde_json::Value>> {
    let (token, user, expires_at) = auth::verify_code(&state.db, &state.cfg, &req.email, &req.code).await?;
    Ok(Json(json!({ "token": token, "user": user, "expiresAt": expires_at })))
}

async fn logout(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> AppResult<Json<serde_json::Value>> {
    if let Some(token) = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    {
        let _ = auth::logout(&state.db, token).await;
    }
    Ok(Json(json!({ "ok": true })))
}

async fn me(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
) -> AppResult<Json<serde_json::Value>> {
    let user = get_user(&state, &user.0).await?;
    Ok(Json(json!({ "user": user.to_api() })))
}

/// 简单用户目录（演示环境）：用于新建会话时选择联系人。
/// 生产应由组织通讯录/好友关系提供（设计文档 §11 开放平台）。
async fn directory(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
) -> AppResult<Json<serde_json::Value>> {
    let rows: Vec<User> = sqlx::query_as(
        "SELECT * FROM \"user\" WHERE id <> $1 ORDER BY created_at ASC LIMIT 100",
    )
    .bind(&user.0)
    .fetch_all(&state.db.pg)
    .await?;
    Ok(Json(json!({ "users": rows.iter().map(|u| u.to_api()).collect::<Vec<_>>() })))
}

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

async fn list_conversations(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
) -> AppResult<Json<serde_json::Value>> {
    let views: Vec<ConversationView> = conversation::list_conversations(&state.db, &user.0).await?;
    Ok(Json(json!({ "views": views })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConversationReq {
    #[serde(rename = "type")]
    conv_type: String,
    member_user_ids: Vec<String>,
    title: Option<String>,
}

async fn create_conversation(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Json(req): Json<CreateConversationReq>,
) -> AppResult<Json<serde_json::Value>> {
    let conv_id = match req.conv_type.as_str() {
        "direct" => {
            let peer = req.member_user_ids.first().ok_or_else(|| AppError::bad("direct 会话需要 1 个对方成员"))?;
            conversation::create_direct(&state.db, &state.events, &user.0, peer).await?
        }
        "group" => conversation::create_group(&state.db, &state.events, &user.0, &req.member_user_ids, req.title.as_deref()).await?,
        other => return Err(AppError::bad(format!("未知的会话类型: {other}"))),
    };
    let views = conversation::list_conversations(&state.db, &user.0).await?;
    let view = views.into_iter().find(|v| v.conversation.id == conv_id)
        .ok_or_else(|| AppError::internal_msg("会话创建后未能在列表中找到"))?;
    Ok(Json(json!({ "view": view })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMessagesQuery {
    before_seq: Option<i64>,
    limit: Option<i64>,
}

async fn list_messages(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(id): Path<String>,
    Query(q): Query<ListMessagesQuery>,
) -> AppResult<Json<serde_json::Value>> {
    message::ensure_member(&state.db.pg, &id, &user.0).await?;
    let limit = q.limit.unwrap_or(50).clamp(1, 100);
    let (messages, has_more) = message::history(&state.db.pg, &id, q.before_seq, limit).await?;
    Ok(Json(json!({ "messages": messages, "hasMore": has_more })))
}

async fn list_members(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    message::ensure_member(&state.db.pg, &id, &user.0).await?;
    let members = conversation::get_members(&state.db, &id).await?;
    Ok(Json(json!({ "members": members })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettingsReq {
    ai_mode: Option<String>,
    temp_hours: Option<i64>,
}

async fn update_settings(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(id): Path<String>,
    Json(req): Json<UpdateSettingsReq>,
) -> AppResult<Json<serde_json::Value>> {
    if let Some(mode) = &req.ai_mode {
        if !["manual", "draft", "auto", "off"].contains(&mode.as_str()) {
            return Err(AppError::bad("档位必须是 manual/draft/auto/off"));
        }
        conversation::set_ai_mode(&state.db, &user.0, &id, mode, req.temp_hours).await?;
    }
    Ok(Json(json!({ "ok": true })))
}

async fn takeover(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    conversation::takeover(&state.db, &user.0, &id).await?;
    Ok(Json(json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// 卡片 / 反馈 / 设备
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardActionReq {
    action: String,
    edited_text: Option<String>,
}

async fn card_action(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(msg_id): Path<String>,
    Json(req): Json<CardActionReq>,
) -> AppResult<Json<serde_json::Value>> {
    message::card_action(&state.db, &user.0, &msg_id, &req.action, req.edited_text).await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackReq {
    #[serde(rename = "type")]
    feedback_type: String,
    corrected_text: Option<String>,
    reason: Option<String>,
}

async fn submit_feedback(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(msg_id): Path<String>,
    Json(req): Json<FeedbackReq>,
) -> AppResult<Json<serde_json::Value>> {
    message::submit_feedback(&state.db, &user.0, &msg_id, &req.feedback_type, req.corrected_text, req.reason).await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterDeviceReq {
    device_id: String,
    platform: String,
    push_token: Option<String>,
    app_version: Option<String>,
    capabilities: Option<serde_json::Value>,
}

async fn register_device(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Json(req): Json<RegisterDeviceReq>,
) -> AppResult<Json<serde_json::Value>> {
    auth::register_device(
        &state.db,
        &user.0,
        &req.device_id,
        &req.platform,
        req.push_token.as_deref(),
        req.capabilities.as_ref(),
        req.app_version.as_deref(),
    )
    .await?;
    Ok(Json(json!({ "ok": true })))
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

pub async fn get_user(state: &AppState, user_id: &str) -> AppResult<User> {
    sqlx::query_as::<_, User>("SELECT * FROM \"user\" WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.db.pg)
        .await?
        .ok_or_else(|| AppError::not_found("用户不存在"))
}

pub async fn get_principal(state: &AppState, id: &str) -> AppResult<Principal> {
    sqlx::query_as::<_, Principal>("SELECT * FROM principal WHERE id = $1")
        .bind(id)
        .fetch_optional(&state.db.pg)
        .await?
        .ok_or_else(|| AppError::not_found("主体不存在"))
}
