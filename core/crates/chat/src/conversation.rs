//! 会话与成员：列表视图、direct 幂等复用、群聊、档位切换、接管。

use im_core_common::{ids, time, AppError, AppResult};
use im_core_store::Db;
use serde_json::json;
use sqlx::{PgPool, Postgres, Transaction};

use crate::events::{DomainEvent, EventTx};
use crate::message::outbox_insert;
use crate::model::{Content, ConversationView};
use crate::presence;

// ---------------------------------------------------------------------------
// 列表
// ---------------------------------------------------------------------------

#[derive(sqlx::FromRow)]
struct ConvRow {
    id: String,
    conv_type: String,
    title: Option<String>,
    system_tag: Option<String>,
    last_seq: i64,
    created_at: chrono::DateTime<chrono::Utc>,
    role: String,
    ai_mode: String,
    ai_mode_until: Option<chrono::DateTime<chrono::Utc>>,
    last_read_seq: i64,
    unread: Option<i64>,
    peer_name: Option<String>,
    last_content: Option<serde_json::Value>,
    last_recalled: Option<bool>,
    last_at: Option<chrono::DateTime<chrono::Utc>>,
    last_sender_id: Option<String>,
}

pub async fn list_conversations(db: &Db, user_id: &str) -> AppResult<Vec<ConversationView>> {
    let rows = sqlx::query_as::<_, ConvRow>(
        r#"SELECT c.id, c.type AS conv_type, c.title, c.system_tag, c.last_seq, c.created_at,
                  m.role, m.ai_mode, m.ai_mode_until, m.last_read_seq,
                  (SELECT count(*) FROM message mm
                     WHERE mm.conv_id = c.id AND mm.seq > m.last_read_seq
                       AND mm.sender_id <> m.principal_id) AS unread,
                  (SELECT p.name FROM member m2
                     JOIN principal p ON p.id = m2.principal_id
                     WHERE m2.conv_id = c.id AND m2.principal_id <> m.principal_id
                       AND p.type = CASE WHEN c.system_tag = 'avatar_self' THEN 'avatar' ELSE 'human' END
                     LIMIT 1) AS peer_name,
                  lm.content AS last_content, lm.recalled AS last_recalled,
                  lm.created_at AS last_at, lm.sender_id AS last_sender_id
           FROM member m
           JOIN conversation c ON c.id = m.conv_id
           LEFT JOIN LATERAL
             (SELECT * FROM message WHERE conv_id = c.id ORDER BY seq DESC LIMIT 1) lm ON TRUE
           WHERE m.principal_id = $1
           ORDER BY COALESCE(lm.created_at, c.created_at) DESC"#,
    )
    .bind(user_id)
    .fetch_all(&db.pg)
    .await?;

    let views = rows
        .into_iter()
        .map(|r| {
            let display_title = match (r.system_tag.as_deref(), r.conv_type.as_str()) {
                (Some("avatar_self"), _) => r.peer_name.clone().unwrap_or_else(|| "我的分身".into()),
                (_, "group") => r.title.clone().unwrap_or_else(|| "群聊".into()),
                _ => r.peer_name.clone().unwrap_or_else(|| "对话".into()),
            };
            let last_msg_preview = r.last_content.as_ref().and_then(|c| {
                if r.last_recalled == Some(true) {
                    return Some("消息已撤回".to_string());
                }
                serde_json::from_value::<Content>(c.clone()).ok().map(|c| c.preview())
            });
            ConversationView {
                conversation: crate::model::Conversation {
                    id: r.id,
                    conv_type: r.conv_type,
                    title: r.title,
                    system_tag: r.system_tag,
                    last_seq: r.last_seq,
                    created_at: time::iso(r.created_at),
                },
                my_principal_id: user_id.to_string(),
                my_role: r.role,
                my_ai_mode: r.ai_mode,
                my_ai_mode_until: r.ai_mode_until.map(time::iso),
                my_last_read_seq: r.last_read_seq,
                unread_count: r
                    .unread
                    .unwrap_or(0)
                    .try_into()
                    .unwrap_or(0u32) as i64,
                display_title,
                last_msg_preview,
                last_msg_at: r.last_at.map(time::iso),
                last_msg_sender_id: r.last_sender_id,
            }
        })
        .collect();
    Ok(views)
}

// ---------------------------------------------------------------------------
// 创建
// ---------------------------------------------------------------------------

/// 单聊：幂等复用已存在的两人 direct 会话（设计方案 §25.2 补充）
pub async fn create_direct(db: &Db, events: &EventTx, user_id: &str, peer_user_id: &str) -> AppResult<String> {
    if user_id == peer_user_id {
        return Err(AppError::bad("不能与自己创建单聊（如需体验分身，请使用「我的分身」会话）"));
    }
    let existing: Option<(String,)> = sqlx::query_as(
        r#"SELECT c.id FROM conversation c
           WHERE c.type = 'direct' AND c.system_tag IS NULL
             AND EXISTS (SELECT 1 FROM member m WHERE m.conv_id = c.id AND m.principal_id = $1)
             AND EXISTS (SELECT 1 FROM member m WHERE m.conv_id = c.id AND m.principal_id = $2)
             AND NOT EXISTS (
               SELECT 1 FROM member m JOIN principal p ON p.id = m.principal_id
               WHERE m.conv_id = c.id AND p.type = 'human' AND m.principal_id NOT IN ($1, $2))
           LIMIT 1"#,
    )
    .bind(user_id)
    .bind(peer_user_id)
    .fetch_optional(&db.pg)
    .await?;
    if let Some((id,)) = existing {
        return Ok(id);
    }

    let peer: Option<(String,)> = sqlx::query_as("SELECT id FROM \"user\" WHERE id = $1")
        .bind(peer_user_id)
        .fetch_optional(&db.pg)
        .await?;
    if peer.is_none() {
        return Err(AppError::not_found("对方用户不存在"));
    }

    let mut tx = db.pg.begin().await?;
    let conv_id = ids::new_conv_id();
    sqlx::query("INSERT INTO conversation (id, type) VALUES ($1, 'direct')")
        .bind(&conv_id)
        .execute(&mut *tx)
        .await?;
    insert_members_with_avatars(
        &mut tx,
        &conv_id,
        &[user_id.to_string(), peer_user_id.to_string()],
        None,
    )
    .await?;
    tx.commit().await?;

    notify_conversations_changed(db, events, &conv_id).await;
    Ok(conv_id)
}

pub async fn create_group(
    db: &Db,
    events: &EventTx,
    user_id: &str,
    member_user_ids: &[String],
    title: Option<&str>,
) -> AppResult<String> {
    let mut members: Vec<String> = vec![user_id.to_string()];
    for uid in member_user_ids {
        if uid != user_id && !members.contains(uid) {
            members.push(uid.clone());
        }
    }
    if members.len() < 2 {
        return Err(AppError::bad("群聊至少需要 2 名成员"));
    }
    for uid in &members[1..] {
        let ok: Option<(String,)> = sqlx::query_as("SELECT id FROM \"user\" WHERE id = $1")
            .bind(uid)
            .fetch_optional(&db.pg)
            .await?;
        if ok.is_none() {
            return Err(AppError::not_found(format!("用户不存在: {uid}")));
        }
    }

    let mut tx = db.pg.begin().await?;
    let conv_id = ids::new_conv_id();
    sqlx::query("INSERT INTO conversation (id, type, title) VALUES ($1, 'group', $2)")
        .bind(&conv_id)
        .bind(title)
        .execute(&mut *tx)
        .await?;
    insert_members_with_avatars(&mut tx, &conv_id, &members, Some(user_id)).await?;
    tx.commit().await?;

    notify_conversations_changed(db, events, &conv_id).await;
    Ok(conv_id)
}

/// 内部接口：Bun 为新用户创建「我的分身」系统会话（system_tag = avatar_self）
pub async fn create_avatar_self_conversation(db: &Db, user_id: &str, avatar_id: &str) -> AppResult<String> {
    let mut tx = db.pg.begin().await?;
    let conv_id = ids::new_conv_id();
    sqlx::query("INSERT INTO conversation (id, type, system_tag) VALUES ($1, 'direct', 'avatar_self')")
        .bind(&conv_id)
        .execute(&mut *tx)
        .await?;
    for pid in [user_id, avatar_id] {
        sqlx::query("INSERT INTO member (conv_id, principal_id, role) VALUES ($1, $2, 'member')")
            .bind(&conv_id)
            .bind(pid)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    tracing::info!(conv_id = %conv_id, user_id, avatar_id, "avatar-self conversation created");
    Ok(conv_id)
}

/// human 成员 + 各自的 avatar 分身一起入会（分身是会话一等成员 —— 设计方案 §1）
async fn insert_members_with_avatars(
    tx: &mut Transaction<'_, Postgres>,
    conv_id: &str,
    user_ids: &[String],
    owner_id: Option<&str>,
) -> AppResult<()> {
    for uid in user_ids {
        let role = if Some(uid) == owner_id.map(|s| s.to_string()).as_ref() { "owner" } else { "member" };
        sqlx::query("INSERT INTO member (conv_id, principal_id, role) VALUES ($1, $2, $3)")
            .bind(conv_id)
            .bind(uid)
            .bind(role)
            .execute(&mut **tx)
            .await?;
    }
    let avatars: Vec<(String,)> = sqlx::query_as(
        "SELECT id FROM principal WHERE type = 'avatar' AND owner_id = ANY($1)",
    )
    .bind(user_ids)
    .fetch_all(&mut **tx)
    .await?;
    for (aid,) in avatars {
        sqlx::query(
            "INSERT INTO member (conv_id, principal_id, role) VALUES ($1, $2, 'member')
             ON CONFLICT DO NOTHING",
        )
        .bind(conv_id)
        .bind(aid)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 成员视图
// ---------------------------------------------------------------------------

pub async fn get_members(db: &Db, conv_id: &str) -> AppResult<Vec<crate::model::MemberView>> {
    let rows = sqlx::query_as::<_, MemberRow>(
        r#"SELECT m.principal_id, p.type AS principal_type, p.owner_id, p.name,
                  m.role, m.ai_mode, m.ai_mode_until, m.last_read_seq
           FROM member m JOIN principal p ON p.id = m.principal_id
           WHERE m.conv_id = $1
           ORDER BY (p.type = 'human') DESC, m.joined_at ASC"#,
    )
    .bind(conv_id)
    .fetch_all(&db.pg)
    .await?;

    let mut views = Vec::with_capacity(rows.len());
    for r in rows {
        let online = if r.principal_type == "human" {
            presence::is_online(db, &r.principal_id).await
        } else {
            false
        };
        views.push(crate::model::MemberView {
            principal_id: r.principal_id,
            principal_type: r.principal_type,
            owner_id: r.owner_id,
            name: r.name,
            role: r.role,
            ai_mode: r.ai_mode,
            ai_mode_until: r.ai_mode_until.map(time::iso),
            last_read_seq: r.last_read_seq,
            online,
        });
    }
    Ok(views)
}

#[derive(sqlx::FromRow)]
struct MemberRow {
    principal_id: String,
    principal_type: String,
    owner_id: Option<String>,
    name: String,
    role: String,
    ai_mode: String,
    ai_mode_until: Option<chrono::DateTime<chrono::Utc>>,
    last_read_seq: i64,
}

// ---------------------------------------------------------------------------
// 档位与接管
// ---------------------------------------------------------------------------

/// 切换我的分身在此会话的档位（支持临时模式）→ outbox policy.changed（Bun 失效缓存）
pub async fn set_ai_mode(
    db: &Db,
    user_id: &str,
    conv_id: &str,
    mode: &str,
    temp_hours: Option<i64>,
) -> AppResult<()> {
    crate::message::ensure_member(&db.pg, conv_id, user_id).await?;
    let until = temp_hours.map(|h| time::now() + chrono::Duration::hours(h));
    let res = sqlx::query(
        "UPDATE member SET ai_mode = $3, ai_mode_until = $4
         WHERE conv_id = $1 AND principal_id = $2",
    )
    .bind(conv_id)
    .bind(user_id)
    .bind(mode)
    .bind(until)
    .execute(&db.pg)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found("会话不存在或你不是成员"));
    }

    let mut tx = db.pg.begin().await?;
    let data = json!({ "userId": user_id, "convId": conv_id });
    outbox_insert(&mut tx, "policy.changed", user_id, &data).await?;
    tx.commit().await?;
    tracing::info!(conv_id, user_id, mode, ?temp_hours, "ai mode updated");
    Ok(())
}

/// 一键接管：outbox takeover.requested —— Bun 取消进行中任务并对该话题冷却（设计方案 §4.3）
pub async fn takeover(db: &Db, user_id: &str, conv_id: &str) -> AppResult<()> {
    crate::message::ensure_member(&db.pg, conv_id, user_id).await?;
    let mut tx = db.pg.begin().await?;
    let data = json!({ "userId": user_id, "convId": conv_id });
    outbox_insert(&mut tx, "takeover.requested", conv_id, &data).await?;
    tx.commit().await?;
    tracing::info!(conv_id, user_id, "takeover requested");
    Ok(())
}

// ---------------------------------------------------------------------------
// 内部查询
// ---------------------------------------------------------------------------

/// 会话成员的 user id（human）
pub async fn conversation_user_ids(pg: &PgPool, conv_id: &str) -> AppResult<Vec<String>> {
    crate::message::conversation_recipients(pg, conv_id).await
}

async fn notify_conversations_changed(db: &Db, events: &EventTx, conv_id: &str) {
    if let Ok(recipients) = crate::message::conversation_recipients(&db.pg, conv_id).await {
        let _ = events.send(DomainEvent::ConversationsChanged { recipients });
    }
}
