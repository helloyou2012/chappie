//! 消息写入与读路径 —— 设计方案 §25.2（核心路径：单事务幂等 + seq + outbox）。

use im_core_common::{ids, time, AppError, AppResult, Config};
use im_core_store::Db;
use serde::Serialize;
use serde_json::json;
use sqlx::{Executor, PgPool, Postgres, Transaction};

use crate::events::{DomainEvent, EventTx};
use crate::model::{ActivityItem, AiMeta, CardPayload, Content, Message, MessageRow, Principal};

// ---------------------------------------------------------------------------
// 发送参数
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct SendParams {
    pub client_msg_id: String,
    pub conv_id: String,
    pub sender: Principal,
    pub on_behalf_of: Option<String>,
    pub content: Content,
    pub mentions: Vec<String>,
    pub reply_to: Option<String>,
    pub ai_meta: Option<AiMeta>,
    /// AI 发送时捕获的接待版本（真人发送时忽略）
    pub authority_version: i64,
    /// 触发来源；core 用 `mention/self_chat/owner_approved/internal_card` 做豁免
    pub via: Option<String>,
    /// 流式消息：先只对主人可见并允许增量更新，定稿后才对外广播（仅分身消息）
    pub streaming: bool,
}

/// outbox 事件 envelope（对齐 packages/contract/src/events.ts）
pub async fn outbox_insert(
    tx: &mut Transaction<'_, Postgres>,
    topic: &str,
    key: &str,
    data: &serde_json::Value,
) -> AppResult<()> {
    let payload = json!({
        "eventId": ids::new_id("evt"),
        "topic": topic,
        "key": key,
        "traceId": null,
        "occurredAt": time::now_iso(),
        "data": data,
    });
    sqlx::query("INSERT INTO outbox (topic, key, payload) VALUES ($1, $2, $3)")
        .bind(topic)
        .bind(key)
        .bind(payload)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// 发送（单写者路径：人类 WS 与分身内部 API 最终都走这里）
// ---------------------------------------------------------------------------

pub async fn send_message(db: &Db, cfg: &Config, events: &EventTx, p: SendParams) -> AppResult<Message> {
    if p.streaming && p.sender.principal_type != "avatar" {
        return Err(AppError::bad("只有分身消息支持流式生成"));
    }
    // 分身代发强校验（设计方案 §28.2：hop_count 强校验；§10：冻结失效）
    if p.sender.principal_type == "avatar" {
        if p.sender.status != "active" {
            return Err(AppError::forbidden("分身已被冻结，无法代发消息"));
        }
        let hop = p.ai_meta.as_ref().map(|m| m.hop_count).unwrap_or(0);
        if hop >= cfg.max_hop_count {
            return Err(AppError::forbidden(format!(
                "HOP_LIMIT_EXCEEDED: AI 对 AI 对话跳数已达上限（{}），已停止以保护双方",
                cfg.max_hop_count
            )));
        }
        if p.on_behalf_of.as_deref() != p.sender.owner_id.as_deref() {
            return Err(AppError::forbidden("on_behalf_of 必须等于分身主人"));
        }
    }

    let mut tx = db.pg.begin().await?;

    // 1. 幂等：同 sender + client_msg_id 直接返回已有结果
    if let Some(existing) = sqlx::query_as::<_, MessageRow>(
        "SELECT * FROM message WHERE sender_id = $1 AND client_msg_id = $2 LIMIT 1",
    )
    .bind(&p.sender.id)
    .bind(&p.client_msg_id)
    .fetch_optional(&mut *tx)
    .await?
    {
        return existing.try_into();
    }

    // 2. 成员校验
    let is_member: Option<(String,)> =
        sqlx::query_as("SELECT role FROM member WHERE conv_id = $1 AND principal_id = $2")
            .bind(&p.conv_id)
            .bind(&p.sender.id)
            .fetch_optional(&mut *tx)
            .await?;
    if is_member.is_none() {
        return Err(AppError::forbidden("发送者不是会话成员"));
    }

    // 2.5 接待权围栏：确认此刻谁被授权发言；真人发言在私聊中自动接管。
    let conv_meta: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT type, system_tag FROM conversation WHERE id = $1")
            .bind(&p.conv_id)
            .fetch_optional(&mut *tx)
            .await?;
    let (conv_type, system_tag) =
        conv_meta.ok_or_else(|| AppError::not_found("会话不存在"))?;

    if p.sender.principal_type == "avatar" {
        let owner_id = p
            .on_behalf_of
            .as_deref()
            .or(p.sender.owner_id.as_deref())
            .ok_or_else(|| AppError::forbidden("分身消息缺少主人"))?;
        let via = p.via.as_deref();
        let is_internal_card = matches!(p.content, Content::Card { .. })
            && (system_tag.as_deref() == Some("avatar_self") || via == Some("internal_card"));
        if !is_internal_card {
            crate::reception::enforce_avatar_send(
                &mut tx,
                &p.conv_id,
                owner_id,
                p.authority_version,
                via,
            )
            .await?;
        }
    } else if p.sender.principal_type == "human" {
        crate::reception::human_interjection(
            &mut tx,
            &p.conv_id,
            &p.sender.id,
            &conv_type,
            system_tag.as_deref(),
        )
        .await?;
    }

    // 3. seq 分配：会话行锁，天然保证同会话串行且不回退
    let seq: i64 = sqlx::query_scalar(
        "UPDATE conversation SET last_seq = last_seq + 1 WHERE id = $1 RETURNING last_seq",
    )
    .bind(&p.conv_id)
    .fetch_one(&mut *tx)
    .await?;

    let msg_id = ids::new_msg_id();
    let created_at = time::now();
    let content_json = serde_json::to_value(&p.content)?;
    // 流式消息：标记 streaming + ownerOnly，定稿前只对主人可见
    let mut ai_meta = p.ai_meta.clone();
    if p.streaming {
        let meta = ai_meta.get_or_insert_with(AiMeta::default);
        meta.streaming = true;
        meta.owner_only = true;
    }
    let ai_meta_json = ai_meta.as_ref().map(serde_json::to_value).transpose()?;

    // 4. 写入消息行
    sqlx::query(
        r#"INSERT INTO message
           (msg_id, conv_id, seq, sender_id, sender_type, on_behalf_of, content, mentions, reply_to, ai_meta, client_msg_id, recalled, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,$12)"#,
    )
    .bind(&msg_id)
    .bind(&p.conv_id)
    .bind(seq)
    .bind(&p.sender.id)
    .bind(&p.sender.principal_type)
    .bind(&p.on_behalf_of)
    .bind(&content_json)
    .bind(&p.mentions)
    .bind(&p.reply_to)
    .bind(ai_meta_json)
    .bind(&p.client_msg_id)
    .bind(created_at)
    .execute(&mut *tx)
    .await?;

    let message = Message {
        msg_id: msg_id.clone(),
        conv_id: p.conv_id.clone(),
        seq,
        client_msg_id: Some(p.client_msg_id.clone()),
        sender_id: p.sender.id.clone(),
        sender_type: p.sender.principal_type.clone(),
        on_behalf_of: p.on_behalf_of.clone(),
        content: p.content.clone(),
        mentions: p.mentions.clone(),
        reply_to: p.reply_to.clone(),
        ai_meta: ai_meta.clone(),
        recalled: false,
        created_at: time::iso(created_at),
    };

    // 5. outbox：message.created（同事务，事件不丢）。
    // 流式消息先不触发 AI 链路，定稿可见时再写入，避免半截内容被其他分身当成新消息。
    if !p.streaming {
        let members = members_snapshot(&mut tx, &p.conv_id).await?;
        let data = json!({ "message": message, "members": members });
        outbox_insert(&mut tx, "message.created", &p.conv_id, &data).await?;
    }

    tx.commit().await?;

    // 6. 进程内 fanout（提交后）：流式消息只推给主人
    let recipients = if p.streaming {
        owner_recipients(p.on_behalf_of.as_deref(), p.sender.owner_id.as_deref())
    } else {
        conversation_recipients(&db.pg, &p.conv_id).await?
    };
    let _ = events.send(DomainEvent::MessageCreated { message: message.clone(), recipients });
    Ok(message)
}

// ---------------------------------------------------------------------------
// 读路径
// ---------------------------------------------------------------------------

pub async fn get_message(pg: &PgPool, msg_id: &str) -> AppResult<MessageRow> {
    sqlx::query_as::<_, MessageRow>("SELECT * FROM message WHERE msg_id = $1")
        .bind(msg_id)
        .fetch_optional(pg)
        .await?
        .ok_or_else(|| AppError::not_found("消息不存在"))
}

/// 校验 principal 是会话成员
pub async fn ensure_member(pg: &PgPool, conv_id: &str, principal_id: &str) -> AppResult<()> {
    let ok: Option<(String,)> =
        sqlx::query_as("SELECT role FROM member WHERE conv_id = $1 AND principal_id = $2")
            .bind(conv_id)
            .bind(principal_id)
            .fetch_optional(pg)
            .await?;
    if ok.is_none() {
        return Err(AppError::forbidden("你不是该会话的成员"));
    }
    Ok(())
}

// 可见性过滤：ownerOnly 消息只有主人（on_behalf_of）或发送者可见；
// NULL viewer（AI 内部读上下文）不过滤。
/// 历史消息（beforeSeq 向前翻页，返回按 seq 升序）
pub async fn history(
    pg: &PgPool,
    conv_id: &str,
    before_seq: Option<i64>,
    limit: i64,
    viewer_id: Option<&str>,
) -> AppResult<(Vec<Message>, bool)> {
    let rows = sqlx::query_as::<_, MessageRow>(
        "SELECT * FROM message
         WHERE conv_id = $1 AND ($2::bigint IS NULL OR seq < $2)
           AND ($4::text IS NULL
                OR COALESCE((ai_meta->>'ownerOnly')::boolean, false) = false
                OR on_behalf_of = $4 OR sender_id = $4)
         ORDER BY seq DESC LIMIT $3",
    )
    .bind(conv_id)
    .bind(before_seq)
    .bind(limit)
    .bind(viewer_id)
    .fetch_all(pg)
    .await?;
    let has_more = rows.len() == limit as usize;
    let mut messages = rows.into_iter().map(Message::try_from).collect::<AppResult<Vec<_>>>()?;
    messages.reverse();
    for msg in &mut messages {
        strip_owner_meta_for_viewer(msg, viewer_id);
    }
    Ok((messages, has_more))
}

/// 思考与工具活动仅主人可见：非主人视角剥离 ai_meta.thinking / activity。
fn strip_owner_meta_for_viewer(msg: &mut Message, viewer_id: Option<&str>) {
    let Some(viewer) = viewer_id else { return };
    if msg.on_behalf_of.as_deref() == Some(viewer) {
        return;
    }
    if let Some(meta) = msg.ai_meta.as_mut() {
        meta.thinking = None;
        meta.activity = None;
    }
}

/// 按 seq 补洞：(fromSeq, fromSeq + limit]
pub async fn pull_range(
    pg: &PgPool,
    conv_id: &str,
    from_seq: i64,
    limit: i64,
    viewer_id: Option<&str>,
) -> AppResult<Vec<Message>> {
    let rows = sqlx::query_as::<_, MessageRow>(
        "SELECT * FROM message
         WHERE conv_id = $1 AND seq > $2 AND seq <= $2 + $3
           AND ($4::text IS NULL
                OR COALESCE((ai_meta->>'ownerOnly')::boolean, false) = false
                OR on_behalf_of = $4 OR sender_id = $4)
         ORDER BY seq ASC",
    )
    .bind(conv_id)
    .bind(from_seq)
    .bind(limit)
    .bind(viewer_id)
    .fetch_all(pg)
    .await?;
    let mut messages = rows
        .into_iter()
        .map(Message::try_from)
        .collect::<AppResult<Vec<_>>>()?;
    for msg in &mut messages {
        strip_owner_meta_for_viewer(msg, viewer_id);
    }
    Ok(messages)
}

/// 流式消息的推送对象：只给主人（on_behalf_of，缺省回落到分身 owner）。
fn owner_recipients(on_behalf_of: Option<&str>, sender_owner: Option<&str>) -> Vec<String> {
    on_behalf_of
        .or(sender_owner)
        .map(|owner| vec![owner.to_string()])
        .unwrap_or_default()
}

fn is_streaming(meta: &Option<serde_json::Value>) -> bool {
    meta.as_ref()
        .and_then(|m| m.get("streaming"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// 流式增量：用 AI 侧累积的完整文本替换内容（持久化，刷新/重连可见），仅推给主人。
pub async fn update_stream_text(
    db: &Db,
    events: &EventTx,
    msg_id: &str,
    text: &str,
    thinking: Option<&str>,
    activity: Option<Vec<ActivityItem>>,
) -> AppResult<Message> {
    let row = get_message(&db.pg, msg_id).await?;
    if row.recalled {
        return Err(AppError::bad("消息已撤回，不能继续流式更新"));
    }
    let mut content: Content = serde_json::from_value(row.content.clone())?;
    match &mut content {
        Content::Text { text: t, .. } => *t = text.to_string(),
        _ => return Err(AppError::bad("只有文本消息支持流式更新")),
    }
    let mut ai_meta: AiMeta = row
        .ai_meta
        .clone()
        .and_then(|v| serde_json::from_value::<AiMeta>(v).ok())
        .unwrap_or_default();
    if !ai_meta.streaming {
        return Err(AppError::bad("消息不在流式生成状态"));
    }
    if let Some(t) = thinking {
        ai_meta.thinking = Some(t.to_string());
    }
    if let Some(items) = activity {
        ai_meta.activity = Some(items);
    }
    let ai_meta_json = serde_json::to_value(&ai_meta)?;

    // 流式消息由单一 AI 任务写入，无需乐观锁；仍以 streaming 条件兜底防止定稿后覆盖。
    let updated_row = sqlx::query_as::<_, MessageRow>(
        "UPDATE message SET content = $2, ai_meta = $3
          WHERE msg_id = $1
            AND recalled = false
            AND COALESCE((ai_meta->>'streaming')::boolean, false) = true
          RETURNING *",
    )
    .bind(msg_id)
    .bind(serde_json::to_value(&content)?)
    .bind(&ai_meta_json)
    .fetch_optional(&db.pg)
    .await?
    .ok_or_else(|| AppError::bad("消息不在流式生成状态或已撤回"))?;
    let updated: Message = updated_row.try_into()?;
    let recipients = owner_recipients(updated.on_behalf_of.as_deref(), None);
    let _ = events.send(DomainEvent::MessageUpdated { message: updated.clone(), recipients });
    Ok(updated)
}

/// 流式定稿：写入最终文本与 aiMeta；visible=true 时写入 message.created 并广播给所有成员，
/// 否则保留 ownerOnly，只推给主人（草稿/护栏/转交场景，对外不可见）。
pub async fn finalize_stream_message(
    db: &Db,
    events: &EventTx,
    msg_id: &str,
    text: Option<&str>,
    final_meta: Option<AiMeta>,
    visible: bool,
) -> AppResult<Message> {
    let row = get_message(&db.pg, msg_id).await?;
    if row.recalled {
        return Err(AppError::bad("消息已撤回，不能定稿"));
    }
    if !is_streaming(&row.ai_meta) {
        return Err(AppError::bad("消息不在流式生成状态"));
    }

    let mut content: Content = serde_json::from_value(row.content.clone())?;
    match &mut content {
        Content::Text { text: t, .. } => {
            if let Some(final_text) = text {
                *t = final_text.to_string();
            }
        }
        _ => return Err(AppError::bad("只有文本消息支持流式定稿")),
    }
    // 未提供最终 aiMeta（取消/中断）时保留原有字段，只翻转 streaming/ownerOnly
    let mut ai_meta = match final_meta {
        Some(meta) => meta,
        None => row
            .ai_meta
            .clone()
            .and_then(|v| serde_json::from_value::<AiMeta>(v).ok())
            .unwrap_or_default(),
    };
    ai_meta.streaming = false;
    ai_meta.owner_only = !visible;
    let ai_meta_json = serde_json::to_value(&ai_meta)?;

    let mut tx = db.pg.begin().await?;
    // 对外可见前重新校验接待权：与普通发送同一围栏，避免流式期间被接管后仍然对外发字
    if visible && row.sender_type == "avatar" {
        let owner_id = row
            .on_behalf_of
            .as_deref()
            .ok_or_else(|| AppError::forbidden("AUTHORITY_MISSING: 分身消息缺少主人"))?;
        crate::reception::enforce_avatar_send(
            &mut tx,
            &row.conv_id,
            owner_id,
            ai_meta.authority_version,
            ai_meta.via.as_deref(),
        )
        .await?;
    }
    sqlx::query("UPDATE message SET content = $2, ai_meta = $3 WHERE msg_id = $1")
        .bind(msg_id)
        .bind(serde_json::to_value(&content)?)
        .bind(&ai_meta_json)
        .execute(&mut *tx)
        .await?;

    // 事务内读回（未提交的更新对连接池其它连接不可见）
    let updated_row = sqlx::query_as::<_, MessageRow>("SELECT * FROM message WHERE msg_id = $1")
        .bind(msg_id)
        .fetch_one(&mut *tx)
        .await?;
    let updated: Message = updated_row.try_into()?;

    // 定稿可见 → 此刻才进入 AI 事件链路（与普通发送一致）。
    // outbox 面向其他 AI 任务，剥离仅主人可见的思考与工具活动。
    if visible {
        let mut outbox_msg = updated.clone();
        if let Some(meta) = outbox_msg.ai_meta.as_mut() {
            meta.thinking = None;
            meta.activity = None;
        }
        let members = members_snapshot(&mut tx, &row.conv_id).await?;
        let data = json!({ "message": outbox_msg, "members": members });
        outbox_insert(&mut tx, "message.created", &row.conv_id, &data).await?;
    }
    tx.commit().await?;

    // 思考内容仅主人可见：主人收到完整消息，其他成员收到剥离后的副本
    if visible {
        let owner = updated.on_behalf_of.clone();
        let _ = events.send(DomainEvent::MessageUpdated {
            message: updated.clone(),
            recipients: owner_recipients(owner.as_deref(), None),
        });
        let others: Vec<String> = conversation_recipients(&db.pg, &row.conv_id)
            .await?
            .into_iter()
            .filter(|r| Some(r.as_str()) != owner.as_deref())
            .collect();
        if !others.is_empty() {
            let mut peer_msg = updated.clone();
            if let Some(meta) = peer_msg.ai_meta.as_mut() {
                meta.thinking = None;
                meta.activity = None;
            }
            let _ = events.send(DomainEvent::MessageUpdated {
                message: peer_msg,
                recipients: others,
            });
        }
    } else {
        let _ = events.send(DomainEvent::MessageUpdated {
            message: updated.clone(),
            recipients: owner_recipients(updated.on_behalf_of.as_deref(), None),
        });
    }
    Ok(updated)
}

// ---------------------------------------------------------------------------
// 撤回 / 已读 / 卡片 / 反馈
// ---------------------------------------------------------------------------

pub async fn recall_message(db: &Db, events: &EventTx, actor_id: &str, msg_id: &str) -> AppResult<()> {
    let row = get_message(&db.pg, msg_id).await?;
    if row.recalled {
        return Ok(());
    }
    // 本人，或分身消息的主人（主人可撤回分身的代发）
    let allowed = row.sender_id == actor_id || row.on_behalf_of.as_deref() == Some(actor_id);
    if !allowed {
        return Err(AppError::forbidden("只能撤回自己的消息（或自己分身代发的消息）"));
    }
    ensure_member(&db.pg, &row.conv_id, actor_id).await?;

    let mut tx = db.pg.begin().await?;
    sqlx::query("UPDATE message SET recalled = true, ai_meta = NULL WHERE msg_id = $1")
        .bind(msg_id)
        .execute(&mut *tx)
        .await?;
    let data = json!({ "msgId": msg_id, "convId": row.conv_id, "actorId": actor_id });
    outbox_insert(&mut tx, "message.recalled", &row.conv_id, &data).await?;
    tx.commit().await?;

    let recipients = conversation_recipients(&db.pg, &row.conv_id).await?;
    let _ = events.send(DomainEvent::MessageRecalled {
        conv_id: row.conv_id,
        msg_id: msg_id.to_string(),
        recipients,
    });
    Ok(())
}

pub async fn mark_read(db: &Db, events: &EventTx, principal_id: &str, conv_id: &str, seq: i64) -> AppResult<()> {
    ensure_member(&db.pg, conv_id, principal_id).await?;
    sqlx::query(
        "UPDATE member SET last_read_seq = GREATEST(last_read_seq, $3)
         WHERE conv_id = $1 AND principal_id = $2",
    )
    .bind(conv_id)
    .bind(principal_id)
    .bind(seq)
    .execute(&db.pg)
    .await?;

    let recipients = conversation_recipients(&db.pg, conv_id)
        .await?
        .into_iter()
        .filter(|r| r.as_str() != principal_id)
        .collect();
    let _ = events.send(DomainEvent::ReadSync {
        conv_id: conv_id.to_string(),
        principal_id: principal_id.to_string(),
        last_read_seq: seq,
        recipients,
    });
    Ok(())
}

/// 卡片操作（草稿发送/审批决议/任务取消）→ outbox card.action，由 Bun 异步处理
pub async fn card_action(
    db: &Db,
    events: &EventTx,
    actor_id: &str,
    msg_id: &str,
    action: &str,
    edited_text: Option<String>,
) -> AppResult<()> {
    let row = get_message(&db.pg, msg_id).await?;
    ensure_member(&db.pg, &row.conv_id, actor_id).await?;
    let content: Content = serde_json::from_value(row.content.clone())?;
    let Content::Card { card, .. } = content else {
        return Err(AppError::bad("目标消息不是卡片"));
    };
    // 对端请求真人：由卡片主人直接批准/拒绝，core 同步写接待权威。
    if let CardPayload::HumanRequest { request_id, .. } = &card {
        if matches!(action, "grant_human" | "decline_human") {
            crate::reception::resolve_human_request(
                db,
                events,
                actor_id,
                request_id,
                action == "grant_human",
            )
            .await?;
            return Ok(());
        }
    }
    let data = json!({
        "msgId": msg_id,
        "convId": row.conv_id,
        "actorId": actor_id,
        "action": action,
        "editedText": edited_text,
        "card": card,
    });
    let mut tx = db.pg.begin().await?;
    outbox_insert(&mut tx, "card.action", &row.conv_id, &data).await?;
    tx.commit().await?;
    Ok(())
}

/// 消息反馈（点赞/纠正/举报）→ outbox feedback.submitted（Bun：偏好学习 + 评测集）
pub async fn submit_feedback(
    db: &Db,
    actor_id: &str,
    msg_id: &str,
    feedback_type: &str,
    corrected_text: Option<String>,
    reason: Option<String>,
) -> AppResult<()> {
    let row = get_message(&db.pg, msg_id).await?;
    ensure_member(&db.pg, &row.conv_id, actor_id).await?;
    let data = json!({
        "msgId": msg_id,
        "convId": row.conv_id,
        "actorId": actor_id,
        "feedbackType": feedback_type,
        "correctedText": corrected_text,
        "reason": reason,
    });
    let mut tx = db.pg.begin().await?;
    outbox_insert(&mut tx, "feedback.submitted", &row.conv_id, &data).await?;
    tx.commit().await?;
    Ok(())
}

/// 更新卡片内容（任务进度等；仅内部 API 调用）
pub async fn update_card_content(db: &Db, events: &EventTx, msg_id: &str, card: CardPayload) -> AppResult<Message> {
    let row = get_message(&db.pg, msg_id).await?;
    let content = Content::Card { schema_version: 1, card };
    let content_json = serde_json::to_value(&content)?;
    sqlx::query("UPDATE message SET content = $2 WHERE msg_id = $1")
        .bind(msg_id)
        .bind(&content_json)
        .execute(&db.pg)
        .await?;
    let updated: Message = get_message(&db.pg, msg_id).await?.try_into()?;
    let recipients = conversation_recipients(&db.pg, &row.conv_id).await?;
    let _ = events.send(DomainEvent::MessageUpdated { message: updated.clone(), recipients });
    Ok(updated)
}

// ---------------------------------------------------------------------------
// 成员快照与收件人
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MemberSnapshot {
    pub principal_id: String,
    pub principal_type: String,
    pub owner_id: Option<String>,
}

async fn members_snapshot(tx: &mut Transaction<'_, Postgres>, conv_id: &str) -> AppResult<Vec<MemberSnapshot>> {
    let rows = sqlx::query_as::<_, MemberSnapshot>(
        "SELECT m.principal_id, p.type AS principal_type, p.owner_id
         FROM member m JOIN principal p ON p.id = m.principal_id
         WHERE m.conv_id = $1",
    )
    .bind(conv_id)
    .fetch_all(&mut **tx)
    .await?;
    Ok(rows)
}

/// 在线推送目标：会话内全部 human 成员
pub async fn conversation_recipients(pg: &PgPool, conv_id: &str) -> AppResult<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT m.principal_id FROM member m
         JOIN principal p ON p.id = m.principal_id
         WHERE m.conv_id = $1 AND p.type = 'human'",
    )
    .bind(conv_id)
    .fetch_all(pg)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

/// 与某用户存在共同会话的 human 成员（presence 广播范围）
pub async fn related_users(pg: &PgPool, principal_id: &str) -> AppResult<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT m2.principal_id FROM member m1
         JOIN member m2 ON m1.conv_id = m2.conv_id
         JOIN principal p2 ON p2.id = m2.principal_id
         WHERE m1.principal_id = $1 AND m2.principal_id <> $1 AND p2.type = 'human'",
    )
    .bind(principal_id)
    .fetch_all(pg)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

/// 系统消息（预留：当前未使用；保留以支持 member.changed 等系统通知）
#[allow(dead_code)]
pub async fn send_system_message(
    db: &Db,
    events: &EventTx,
    conv_id: &str,
    text: &str,
) -> AppResult<Message> {
    let system = Principal {
        id: "sys".into(),
        principal_type: "system".into(),
        owner_id: None,
        name: "system".into(),
        status: "active".into(),
    };
    send_message(
        db,
        &Config::from_env(),
        events,
        SendParams {
            client_msg_id: ids::new_id("syscm"),
            conv_id: conv_id.to_string(),
            sender: system,
            on_behalf_of: None,
            content: Content::Text { schema_version: 1, text: text.into() },
            mentions: vec![],
            reply_to: None,
            ai_meta: None,
            authority_version: 0,
            via: Some("system".into()),
            streaming: false,
        },
    )
    .await
}

/// 供 Executor 抽象使用的插入（测试与内部工具）
#[allow(dead_code)]
pub async fn raw_outbox_insert<'e, E>(executor: E, topic: &str, key: &str, payload: &serde_json::Value) -> AppResult<()>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query("INSERT INTO outbox (topic, key, payload) VALUES ($1, $2, $3)")
        .bind(topic)
        .bind(key)
        .bind(payload)
        .execute(executor)
        .await?;
    Ok(())
}
