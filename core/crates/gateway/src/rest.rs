//! 对外 REST API（/api/v1/*）—— 契约见 packages/contract/src/rest.ts。

use axum::extract::{Path, Query, State};
use axum::response::Response;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use im_core_chat::model::{ConversationView, Principal, User};
use im_core_chat::{auth, conversation, friend, message, AppState};
use im_core_common::{time, AppError, AppResult};
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
        .route("/api/v1/contacts", get(list_contacts).post(add_contact))
        .route(
            "/api/v1/contacts/{peer_id}",
            delete(remove_contact).patch(update_contact),
        )
        .route("/api/v1/friend-requests", get(list_friend_requests).post(send_friend_request))
        .route("/api/v1/friend-requests/{id}/accept", post(accept_friend_request))
        .route("/api/v1/friend-requests/{id}/reject", post(reject_friend_request))
        .route("/api/v1/friend-requests/{id}/cancel", post(cancel_friend_request))
        .route("/api/v1/conversations", get(list_conversations).post(create_conversation))
        .route("/api/v1/conversations/{id}", delete(dissolve_group))
        .route("/api/v1/conversations/{id}/transfer-owner", post(transfer_owner))
        .route("/api/v1/conversations/{id}/messages", get(list_messages))
        .route("/api/v1/conversations/{id}/members", get(list_members).post(add_members))
        .route("/api/v1/conversations/{id}/members/{principal_id}", delete(remove_member))
        .route("/api/v1/conversations/{id}/settings", axum::routing::patch(update_settings))
        .route("/api/v1/conversations/{id}/takeover", post(takeover))
        .route("/api/v1/conversations/{id}/release", post(release))
        .route("/api/v1/conversations/{id}/reception", get(get_reception).put(update_reception))
        .route("/api/v1/conversations/{id}/request-human", post(request_human))
        .route(
            "/api/v1/reception/delegations",
            get(list_delegations).post(upsert_delegation),
        )
        .route(
            "/api/v1/reception/delegations/{id}",
            delete(revoke_delegation),
        )
        .route("/api/v1/cards/{msg_id}/action", post(card_action))
        .route("/api/v1/messages/{msg_id}/feedback", post(submit_feedback))
        .route("/api/v1/devices", get(list_devices).post(register_device))
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

/// 联系人列表（取代旧的全站目录：用户只看得到自己添加的联系人）
async fn list_contacts(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
) -> AppResult<Json<serde_json::Value>> {
    let contacts = conversation::list_contacts(&state.db, &user.0).await?;
    Ok(Json(json!({
        "contacts": contacts.iter().map(|c| json!({
            "user": c.user.to_api(),
            "alias": c.alias,
            "tags": c.tags,
            "alwaysNotify": c.always_notify,
            "forceHuman": c.force_human,
            "createdAt": time::iso(c.created_at),
        })).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
pub struct AddContactReq {
    email: String,
}

async fn add_contact(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Json(req): Json<AddContactReq>,
) -> AppResult<Json<serde_json::Value>> {
    if !req.email.contains('@') || req.email.len() < 5 {
        return Err(AppError::bad("邮箱格式不正确"));
    }
    let contact = conversation::add_contact(&state.db, &user.0, &req.email).await?;
    Ok(Json(json!({
        "contact": {
            "user": contact.user.to_api(),
            "alias": contact.alias,
            "tags": contact.tags,
            "alwaysNotify": contact.always_notify,
            "forceHuman": contact.force_human,
            "createdAt": time::iso(contact.created_at),
        }
    })))
}

async fn remove_contact(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(peer_id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    conversation::remove_contact(&state.db, &user.0, &peer_id).await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateContactReq {
    alias: Option<String>,
    tags: Option<Vec<String>>,
    always_notify: Option<bool>,
    force_human: Option<bool>,
}

/// 更新联系人备注名；alias 为空串/null/缺省时清除
async fn update_contact(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(peer_id): Path<String>,
    Json(req): Json<UpdateContactReq>,
) -> AppResult<Json<serde_json::Value>> {
    let contact = conversation::set_contact_alias(
        &state.db,
        &state.events,
        &user.0,
        &peer_id,
        req.alias.as_deref(),
        req.tags,
        req.always_notify,
        req.force_human,
    )
    .await?;
    Ok(Json(json!({
        "contact": {
            "user": contact.user.to_api(),
            "alias": contact.alias,
            "tags": contact.tags,
            "alwaysNotify": contact.always_notify,
            "forceHuman": contact.force_human,
            "createdAt": time::iso(contact.created_at),
        }
    })))
}

// ---------------------------------------------------------------------------
// 好友申请
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendFriendRequestReq {
    email: String,
    message: Option<String>,
}

async fn send_friend_request(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Json(req): Json<SendFriendRequestReq>,
) -> AppResult<Json<serde_json::Value>> {
    if !req.email.contains('@') || req.email.len() < 5 {
        return Err(AppError::bad("邮箱格式不正确"));
    }
    let request = friend::send_request(
        &state.db,
        &state.events,
        &user.0,
        &req.email,
        req.message.as_deref(),
    )
    .await?;
    Ok(Json(json!({ "request": request })))
}

async fn list_friend_requests(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
) -> AppResult<Json<serde_json::Value>> {
    let (incoming, outgoing) = friend::list_requests(&state.db, &user.0).await?;
    Ok(Json(json!({ "incoming": incoming, "outgoing": outgoing })))
}

async fn accept_friend_request(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let request = friend::accept_request(&state.db, &state.events, &user.0, &id).await?;
    Ok(Json(json!({ "request": request })))
}

async fn reject_friend_request(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let request = friend::reject_request(&state.db, &state.events, &user.0, &id).await?;
    Ok(Json(json!({ "request": request })))
}

async fn cancel_friend_request(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let request = friend::cancel_request(&state.db, &state.events, &user.0, &id).await?;
    Ok(Json(json!({ "request": request })))
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
pub struct AddMembersReq {
    member_user_ids: Vec<String>,
}

async fn add_members(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(id): Path<String>,
    Json(req): Json<AddMembersReq>,
) -> AppResult<Json<serde_json::Value>> {
    conversation::add_members(&state.db, &state.events, &user.0, &id, &req.member_user_ids).await?;
    let members = conversation::get_members(&state.db, &id).await?;
    Ok(Json(json!({ "members": members })))
}

async fn remove_member(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path((id, principal_id)): Path<(String, String)>,
) -> AppResult<Json<serde_json::Value>> {
    conversation::remove_member(&state.db, &state.events, &user.0, &id, &principal_id).await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferOwnerReq {
    target_user_id: String,
}

async fn transfer_owner(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(id): Path<String>,
    Json(req): Json<TransferOwnerReq>,
) -> AppResult<Json<serde_json::Value>> {
    conversation::transfer_owner(
        &state.db,
        &state.events,
        &user.0,
        &id,
        &req.target_user_id,
    )
    .await?;
    let members = conversation::get_members(&state.db, &id).await?;
    Ok(Json(json!({ "ok": true, "members": members })))
}

async fn dissolve_group(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    conversation::dissolve_group(&state.db, &state.events, &user.0, &id).await?;
    Ok(Json(json!({ "ok": true })))
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
        conversation::set_ai_mode(&state.db, &state.events, &user.0, &id, mode, req.temp_hours)
            .await?;
    }
    Ok(Json(json!({ "ok": true })))
}

async fn takeover(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let reception = conversation::takeover(&state.db, &state.events, &user.0, &id).await?;
    Ok(Json(json!({ "ok": true, "reception": reception })))
}

async fn release(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    let reception = conversation::release(&state.db, &state.events, &user.0, &id).await?;
    Ok(Json(json!({ "ok": true, "reception": reception })))
}

async fn get_reception(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    message::ensure_member(&state.db.pg, &id, &user.0).await?;
    let my = im_core_chat::reception::get_reception(&state.db.pg, &id, &user.0).await?;
    let peer = match peer_human_id(&state, &id, &user.0).await? {
        Some(pid) => Some(im_core_chat::reception::get_reception(&state.db.pg, &id, &pid).await?),
        None => None,
    };
    Ok(Json(json!({ "my": my, "peer": peer })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReceptionReq {
    state: Option<String>,
    strategy: Option<String>,
    until: Option<String>,
    reason: Option<String>,
}

async fn update_reception(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(id): Path<String>,
    Json(req): Json<UpdateReceptionReq>,
) -> AppResult<Json<serde_json::Value>> {
    let current = im_core_chat::reception::get_reception(&state.db.pg, &id, &user.0).await?;
    let state_value = req.state.as_deref().unwrap_or(&current.state);
    let strategy = req.strategy.as_deref().unwrap_or(&current.strategy);
    let until = match req.until.as_deref() {
        Some(s) => Some(
            chrono::DateTime::parse_from_rfc3339(s)
                .map_err(|_| AppError::bad("until 必须是 ISO 时间"))?
                .with_timezone(&chrono::Utc),
        ),
        None => None,
    };
    let reception = im_core_chat::reception::set_conversation_reception(
        &state.db,
        &state.events,
        &user.0,
        &id,
        state_value,
        strategy,
        until,
        &user.0,
        "owner",
        req.reason.as_deref().unwrap_or("更新接待态"),
    )
    .await?;
    Ok(Json(json!({ "reception": reception })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestHumanReq {
    reason: Option<String>,
}

async fn request_human(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(id): Path<String>,
    Json(req): Json<RequestHumanReq>,
) -> AppResult<Json<serde_json::Value>> {
    let request_id =
        im_core_chat::reception::request_human(&state.db, &state.events, &user.0, &id, req.reason.as_deref())
            .await?;
    Ok(Json(json!({
        "ok": true,
        "requestId": request_id,
        "expiresAt": time::iso(time::now() + chrono::Duration::minutes(30)),
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertDelegationReq {
    scope_type: String,
    scope_id: Option<String>,
    state: String,
    strategy: String,
    #[serde(default)]
    schedule: serde_json::Value,
    #[serde(default = "default_timezone")]
    timezone: String,
    expires_at: Option<String>,
}

fn default_timezone() -> String {
    "Asia/Shanghai".into()
}

async fn list_delegations(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
) -> AppResult<Json<serde_json::Value>> {
    let delegations =
        im_core_chat::reception::list_delegations(&state.db.pg, &user.0).await?;
    Ok(Json(json!({ "delegations": delegations })))
}

async fn upsert_delegation(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Json(req): Json<UpsertDelegationReq>,
) -> AppResult<Json<serde_json::Value>> {
    if !["global", "contact_group", "contact", "conversation"].contains(&req.scope_type.as_str()) {
        return Err(AppError::bad("scopeType 不合法"));
    }
    if !["human", "avatar", "paused"].contains(&req.state.as_str()) {
        return Err(AppError::bad("state 不合法"));
    }
    if !["summon", "assist", "full", "screen", "decline", "escalate", "silent", "off"]
        .contains(&req.strategy.as_str())
    {
        return Err(AppError::bad("strategy 不合法"));
    }
    let expires_at = match req.expires_at.as_deref() {
        Some(s) => Some(
            chrono::DateTime::parse_from_rfc3339(s)
                .map_err(|_| AppError::bad("expiresAt 必须是 ISO 时间"))?
                .with_timezone(&chrono::Utc),
        ),
        None => None,
    };
    let delegation = im_core_chat::reception::upsert_delegation(
        &state.db,
        &state.events,
        &user.0,
        im_core_chat::reception::UpsertDelegation {
            scope_type: &req.scope_type,
            scope_id: req.scope_id.as_deref(),
            state: &req.state,
            strategy: &req.strategy,
            schedule: req.schedule,
            timezone: &req.timezone,
            expires_at,
        },
        &user.0,
        "owner",
        "更新委托",
    )
    .await?;
    Ok(Json(json!({ "delegation": delegation })))
}

async fn revoke_delegation(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
    Path(id): Path<String>,
) -> AppResult<Json<serde_json::Value>> {
    im_core_chat::reception::revoke_delegation(&state.db, &state.events, &user.0, &id).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn peer_human_id(
    state: &AppState,
    conv_id: &str,
    owner_id: &str,
) -> AppResult<Option<String>> {
    let row: Option<(String,)> = sqlx::query_as(
        r#"SELECT m.principal_id FROM member m
           JOIN principal p ON p.id = m.principal_id
           JOIN conversation c ON c.id = m.conv_id
           WHERE m.conv_id = $1 AND c.type = 'direct' AND c.system_tag IS NULL
             AND p.type = 'human' AND m.principal_id <> $2
           LIMIT 1"#,
    )
    .bind(conv_id)
    .bind(owner_id)
    .fetch_optional(&state.db.pg)
    .await?;
    Ok(row.map(|r| r.0))
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
    message::card_action(
        &state.db,
        &state.events,
        &user.0,
        &msg_id,
        &req.action,
        req.edited_text,
    )
    .await?;
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

async fn list_devices(
    State(state): State<AppState>,
    axum::Extension(user): axum::Extension<CurrentUser>,
) -> AppResult<Json<serde_json::Value>> {
    let devices = auth::list_devices(&state.db, &user.0).await?;
    Ok(Json(json!({ "devices": devices })))
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
