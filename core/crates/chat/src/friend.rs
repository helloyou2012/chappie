//! 好友申请：发送 → 接受 / 拒绝 / 取消；接受后建立双向联系人关系。

use im_core_common::{ids, time, AppError, AppResult};
use im_core_store::Db;
use serde::Serialize;
use sqlx::PgPool;

use crate::events::{DomainEvent, EventTx};
use crate::model::UserApi;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendRequestView {
    pub id: String,
    pub from_user: UserApi,
    pub to_user: UserApi,
    pub direction: String,
    pub message: Option<String>,
    pub status: String,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

#[derive(sqlx::FromRow)]
struct FriendRequestRow {
    id: String,
    from_user_id: String,
    from_email: String,
    from_name: String,
    from_avatar_url: Option<String>,
    from_created_at: chrono::DateTime<chrono::Utc>,
    to_user_id: String,
    to_email: String,
    to_name: String,
    to_avatar_url: Option<String>,
    to_created_at: chrono::DateTime<chrono::Utc>,
    message: Option<String>,
    status: String,
    created_at: chrono::DateTime<chrono::Utc>,
    resolved_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl FriendRequestRow {
    fn into_view(self, viewer_id: &str) -> FriendRequestView {
        let direction = if self.from_user_id == viewer_id {
            "outgoing"
        } else {
            "incoming"
        };
        FriendRequestView {
            id: self.id,
            from_user: UserApi {
                id: self.from_user_id,
                email: self.from_email,
                name: self.from_name,
                avatar_url: self.from_avatar_url,
                created_at: time::iso(self.from_created_at),
            },
            to_user: UserApi {
                id: self.to_user_id,
                email: self.to_email,
                name: self.to_name,
                avatar_url: self.to_avatar_url,
                created_at: time::iso(self.to_created_at),
            },
            direction: direction.into(),
            message: self.message,
            status: self.status,
            created_at: time::iso(self.created_at),
            resolved_at: self.resolved_at.map(time::iso),
        }
    }
}

const SELECT_FRIEND_REQUEST: &str = r#"
    SELECT fr.id,
           fr.from_user_id, fu.email AS from_email, fu.name AS from_name,
           fu.avatar_url AS from_avatar_url, fu.created_at AS from_created_at,
           fr.to_user_id, tu.email AS to_email, tu.name AS to_name,
           tu.avatar_url AS to_avatar_url, tu.created_at AS to_created_at,
           fr.message, fr.status, fr.created_at, fr.resolved_at
    FROM friend_request fr
    JOIN "user" fu ON fu.id = fr.from_user_id
    JOIN "user" tu ON tu.id = fr.to_user_id
"#;

async fn get_view(pg: &PgPool, id: &str, viewer_id: &str) -> AppResult<FriendRequestView> {
    let sql = format!("{SELECT_FRIEND_REQUEST} WHERE fr.id = $1");
    let row: Option<FriendRequestRow> = sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(id)
        .fetch_optional(pg)
        .await?;
    row.map(|r| r.into_view(viewer_id))
        .ok_or_else(|| AppError::not_found("好友申请不存在"))
}

fn notify(events: &EventTx, recipients: &[String]) {
    let _ = events.send(DomainEvent::FriendRequestsChanged {
        recipients: recipients.to_vec(),
    });
}

/// 发送好友申请。若对方已经向你发过申请，则直接接受对方的申请。
pub async fn send_request(
    db: &Db,
    events: &EventTx,
    from_user_id: &str,
    email: &str,
    message: Option<&str>,
) -> AppResult<FriendRequestView> {
    let normalized = message.map(str::trim).filter(|m| !m.is_empty());
    if let Some(m) = normalized {
        if m.chars().count() > 200 {
            return Err(AppError::bad("申请留言不能超过 200 个字符"));
        }
    }

    let target: Option<(String,)> = sqlx::query_as(
        r#"SELECT id FROM "user" WHERE lower(email) = lower($1)"#,
    )
    .bind(email)
    .fetch_optional(&db.pg)
    .await?;
    let to_user_id = target
        .map(|r| r.0)
        .ok_or_else(|| AppError::not_found("该邮箱尚未注册"))?;
    if to_user_id == from_user_id {
        return Err(AppError::bad("不能向自己发送好友申请"));
    }

    let already: Option<(String,)> =
        sqlx::query_as("SELECT peer_id FROM contact WHERE user_id = $1 AND peer_id = $2")
            .bind(from_user_id)
            .bind(&to_user_id)
            .fetch_optional(&db.pg)
            .await?;
    if already.is_some() {
        return Err(AppError::conflict("你们已经是联系人"));
    }

    // 对方已发来申请：直接接受，避免双方互等。
    let reverse: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM friend_request
         WHERE from_user_id = $1 AND to_user_id = $2 AND status = 'pending'
         LIMIT 1",
    )
    .bind(&to_user_id)
    .bind(from_user_id)
    .fetch_optional(&db.pg)
    .await?;
    if let Some((id,)) = reverse {
        return accept_request(db, events, from_user_id, &id).await;
    }

    let existing: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM friend_request
         WHERE from_user_id = $1 AND to_user_id = $2 AND status = 'pending'
         LIMIT 1",
    )
    .bind(from_user_id)
    .bind(&to_user_id)
    .fetch_optional(&db.pg)
    .await?;
    if let Some((id,)) = existing {
        return get_view(&db.pg, &id, from_user_id).await;
    }

    let id = ids::new_id("fr");
    sqlx::query(
        "INSERT INTO friend_request (id, from_user_id, to_user_id, message)
         VALUES ($1,$2,$3,$4)",
    )
    .bind(&id)
    .bind(from_user_id)
    .bind(&to_user_id)
    .bind(normalized)
    .execute(&db.pg)
    .await?;

    notify(events, &[from_user_id.to_string(), to_user_id.clone()]);
    get_view(&db.pg, &id, from_user_id).await
}

/// 当前用户的待处理申请：incoming + outgoing。
pub async fn list_requests(
    db: &Db,
    user_id: &str,
) -> AppResult<(Vec<FriendRequestView>, Vec<FriendRequestView>)> {
    let sql = format!(
        "{SELECT_FRIEND_REQUEST}
         WHERE fr.status = 'pending'
           AND (fr.from_user_id = $1 OR fr.to_user_id = $1)
         ORDER BY fr.created_at DESC"
    );
    let rows: Vec<FriendRequestRow> = sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(user_id)
        .fetch_all(&db.pg)
        .await?;
    let mut incoming = Vec::new();
    let mut outgoing = Vec::new();
    for row in rows {
        let view = row.into_view(user_id);
        if view.direction == "incoming" {
            incoming.push(view);
        } else {
            outgoing.push(view);
        }
    }
    Ok((incoming, outgoing))
}

/// 接受申请：仅收件人可操作；事务内建立双向联系人。
pub async fn accept_request(
    db: &Db,
    events: &EventTx,
    user_id: &str,
    request_id: &str,
) -> AppResult<FriendRequestView> {
    let row: Option<(String, String, String)> = sqlx::query_as(
        "SELECT from_user_id, to_user_id, status FROM friend_request WHERE id = $1",
    )
    .bind(request_id)
    .fetch_optional(&db.pg)
    .await?;
    let (from_user_id, to_user_id, status) =
        row.ok_or_else(|| AppError::not_found("好友申请不存在"))?;
    if to_user_id != user_id {
        return Err(AppError::forbidden("只有收件人可以接受好友申请"));
    }
    if status != "pending" {
        return Err(AppError::conflict("好友申请已处理"));
    }

    let mut tx = db.pg.begin().await?;
    sqlx::query(
        "UPDATE friend_request SET status = 'accepted', resolved_at = now()
         WHERE id = $1 AND status = 'pending'",
    )
    .bind(request_id)
    .execute(&mut *tx)
    .await?;
    for (a, b) in [(&from_user_id, &to_user_id), (&to_user_id, &from_user_id)] {
        sqlx::query(
            "INSERT INTO contact (user_id, peer_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        )
        .bind(a)
        .bind(b)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    notify(events, &[from_user_id, to_user_id]);
    get_view(&db.pg, request_id, user_id).await
}

pub async fn reject_request(
    db: &Db,
    events: &EventTx,
    user_id: &str,
    request_id: &str,
) -> AppResult<FriendRequestView> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT from_user_id, to_user_id FROM friend_request
         WHERE id = $1 AND status = 'pending'",
    )
    .bind(request_id)
    .fetch_optional(&db.pg)
    .await?;
    let (from_user_id, to_user_id) =
        row.ok_or_else(|| AppError::not_found("待处理的好友申请不存在"))?;
    if to_user_id != user_id {
        return Err(AppError::forbidden("只有收件人可以拒绝好友申请"));
    }
    sqlx::query(
        "UPDATE friend_request SET status = 'rejected', resolved_at = now()
         WHERE id = $1 AND status = 'pending'",
    )
    .bind(request_id)
    .execute(&db.pg)
    .await?;
    notify(events, &[from_user_id, to_user_id]);
    get_view(&db.pg, request_id, user_id).await
}

pub async fn cancel_request(
    db: &Db,
    events: &EventTx,
    user_id: &str,
    request_id: &str,
) -> AppResult<FriendRequestView> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT from_user_id, to_user_id FROM friend_request
         WHERE id = $1 AND status = 'pending'",
    )
    .bind(request_id)
    .fetch_optional(&db.pg)
    .await?;
    let (from_user_id, to_user_id) =
        row.ok_or_else(|| AppError::not_found("待处理的好友申请不存在"))?;
    if from_user_id != user_id {
        return Err(AppError::forbidden("只有发起人可以取消好友申请"));
    }
    sqlx::query(
        "UPDATE friend_request SET status = 'cancelled', resolved_at = now()
         WHERE id = $1 AND status = 'pending'",
    )
    .bind(request_id)
    .execute(&db.pg)
    .await?;
    notify(events, &[from_user_id, to_user_id]);
    get_view(&db.pg, request_id, user_id).await
}
