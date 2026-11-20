//! 接待权（Reception / Delegation）—— 授权解析、投影、接管与对端请求真人。
//!
//! 设计要点：
//! - `delegation` 是授权事实源；`conversation_reception` 是按会话的快速投影。
//! - 每次授权变化递增 `version`，消息写入路径用它做围栏，避免旧任务在接管后继续发送。
//! - 对端只能「请求」真人，是否切换由主人授权或预先配置决定。

use chrono::{DateTime, Datelike, Timelike, Utc};
use im_core_common::{ids, time, AppError, AppResult};
use im_core_store::Db;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{PgPool, Postgres, Transaction};

use crate::events::{DomainEvent, EventTx};
use crate::message::outbox_insert;
use crate::model::ReceptionView;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleWindow {
    #[serde(default)]
    pub days: Vec<i32>,
    pub start: String,
    pub end: String,
}

fn in_schedule_window(windows: &[ScheduleWindow], now: DateTime<Utc>) -> bool {
    if windows.is_empty() {
        return true;
    }
    // 当前实现按服务端本地时间解释；timezone 字段已保留，后续接入 IANA 时区。
    let local = now.with_timezone(&chrono::Local);
    let day = local.weekday().num_days_from_monday() as i32 + 1;
    let minutes = local.hour() as i32 * 60 + local.minute() as i32;
    for w in windows {
        if !w.days.is_empty() && !w.days.contains(&day) {
            continue;
        }
        let parse = |s: &str| -> Option<i32> {
            let mut it = s.split(':');
            let h: i32 = it.next()?.parse().ok()?;
            let m: i32 = it.next().unwrap_or("0").parse().ok()?;
            Some(h * 60 + m)
        };
        let (Some(start), Some(end)) = (parse(&w.start), parse(&w.end)) else {
            continue;
        };
        if start <= end {
            if minutes >= start && minutes <= end {
                return true;
            }
        } else if minutes >= start || minutes <= end {
            return true;
        }
    }
    false
}

pub fn mode_to_state_strategy(mode: &str) -> (&'static str, &'static str) {
    match mode {
        "auto" => ("avatar", "full"),
        "draft" => ("human", "assist"),
        "off" => ("human", "off"),
        _ => ("human", "summon"),
    }
}

pub fn strategy_to_mode(strategy: &str) -> &'static str {
    match strategy {
        "full" | "screen" | "decline" | "escalate" | "silent" => "auto",
        "assist" => "draft",
        "off" => "off",
        _ => "manual",
    }
}

#[derive(Debug, sqlx::FromRow)]
struct MemberModeRow {
    ai_mode: String,
    ai_mode_source: String,
    ai_mode_until: Option<DateTime<Utc>>,
}

#[derive(Debug, sqlx::FromRow)]
struct ConvInfoRow {
    conv_type: String,
    system_tag: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
#[allow(dead_code)]
struct DelegationRow {
    scope_type: String,
    scope_id: Option<String>,
    state: String,
    strategy: String,
    schedule: serde_json::Value,
    expires_at: Option<DateTime<Utc>>,
    version: i64,
}

#[derive(Debug, Clone)]
pub struct ResolvedReception {
    pub view: ReceptionView,
    pub changed: bool,
    pub previous_state: Option<String>,
    pub previous_strategy: Option<String>,
}

async fn peer_user_id(pg: &PgPool, conv_id: &str, owner_id: &str) -> AppResult<Option<String>> {
    let row: Option<(String,)> = sqlx::query_as(
        r#"SELECT m.principal_id FROM member m
           JOIN principal p ON p.id = m.principal_id
           WHERE m.conv_id = $1 AND p.type = 'human' AND m.principal_id <> $2
           LIMIT 1"#,
    )
    .bind(conv_id)
    .bind(owner_id)
    .fetch_optional(pg)
    .await?;
    Ok(row.map(|r| r.0))
}

async fn contact_tags(pg: &PgPool, owner_id: &str, peer_id: &str) -> AppResult<Vec<String>> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT tag FROM contact_tag_member WHERE user_id = $1 AND peer_id = $2",
    )
    .bind(owner_id)
    .bind(peer_id)
    .fetch_all(pg)
    .await?;
    Ok(rows.into_iter().map(|r| r.0).collect())
}

/// 解析并写回投影。返回当前接待态与是否发生变化。
pub async fn resolve_and_sync(
    pg: &PgPool,
    conv_id: &str,
    owner_id: &str,
) -> AppResult<ResolvedReception> {
    let member: Option<MemberModeRow> = sqlx::query_as(
        "SELECT ai_mode, ai_mode_source, ai_mode_until FROM member WHERE conv_id = $1 AND principal_id = $2",
    )
    .bind(conv_id)
    .bind(owner_id)
    .fetch_optional(pg)
    .await?;
    let member = member.ok_or_else(|| AppError::forbidden("你不是该会话的成员"))?;

    let conv: Option<ConvInfoRow> =
        sqlx::query_as("SELECT type AS conv_type, system_tag FROM conversation WHERE id = $1")
            .bind(conv_id)
            .fetch_optional(pg)
            .await?;
    let conv = conv.ok_or_else(|| AppError::not_found("会话不存在"))?;

    let peer = if conv.conv_type == "direct" && conv.system_tag.is_none() {
        peer_user_id(pg, conv_id, owner_id).await?
    } else {
        None
    };
    let tags = match &peer {
        Some(p) => contact_tags(pg, owner_id, p).await?,
        None => vec![],
    };
    let contact_flags: Option<(bool, bool)> = match &peer {
        Some(p) => sqlx::query_as(
            "SELECT always_notify, force_human FROM contact WHERE user_id = $1 AND peer_id = $2",
        )
        .bind(owner_id)
        .bind(p)
        .fetch_optional(pg)
        .await?,
        None => None,
    };

    let rows: Vec<DelegationRow> = sqlx::query_as(
        r#"SELECT scope_type, scope_id, state, strategy, schedule, expires_at, version
           FROM delegation
           WHERE owner_id = $1 AND revoked_at IS NULL
             AND (expires_at IS NULL OR expires_at > now())
             AND (
               (scope_type = 'conversation' AND scope_id = $2)
               OR (scope_type = 'contact' AND scope_id = $3)
               OR (scope_type = 'contact_group' AND scope_id = ANY($4))
               OR scope_type = 'global'
             )
           ORDER BY CASE scope_type
             WHEN 'conversation' THEN 4
             WHEN 'contact' THEN 3
             WHEN 'contact_group' THEN 2
             ELSE 1
           END DESC, version DESC"#,
    )
    .bind(owner_id)
    .bind(conv_id)
    .bind(&peer)
    .bind(&tags)
    .fetch_all(pg)
    .await?;

    let now = Utc::now();
    let mut chosen: Option<(&DelegationRow, Vec<ScheduleWindow>)> = None;
    // 1) 会话级显式委托最高
    for row in &rows {
        if row.scope_type != "conversation" {
            continue;
        }
        let windows: Vec<ScheduleWindow> =
            serde_json::from_value(row.schedule.clone()).unwrap_or_default();
        if in_schedule_window(&windows, now) {
            chosen = Some((row, windows));
            break;
        }
    }
    // 临时档位到期自动回落 manual（与 AI turn-guard 保持一致）。
    let temp_expired = member
        .ai_mode_until
        .map(|t| t < now)
        .unwrap_or(false);
    let effective_mode = if temp_expired && member.ai_mode != "manual" {
        "manual".to_string()
    } else {
        member.ai_mode.clone()
    };
    let explicit_mode = member.ai_mode_source == "explicit" && !temp_expired;
    // 2) 用户显式选择优先于联系人/分组/全局（会话级委托已在第 1 步胜出）
    if chosen.is_none() && !explicit_mode {
        // 3) 联系人 / 分组 / 全局
        for row in &rows {
            if row.scope_type == "conversation" {
                continue;
            }
            let windows: Vec<ScheduleWindow> =
                serde_json::from_value(row.schedule.clone()).unwrap_or_default();
            if in_schedule_window(&windows, now) {
                chosen = Some((row, windows));
                break;
            }
        }
    }

    let mode_until = if temp_expired {
        None
    } else {
        member.ai_mode_until.map(time::iso)
    };
    let (mut state, strategy, mut source, until) = if let Some((row, _)) = chosen {
        (
            row.state.clone(),
            row.strategy.clone(),
            match row.scope_type.as_str() {
                "conversation" => "conversation",
                "contact" => "contact",
                "contact_group" => "group",
                _ => "global",
            }
            .to_string(),
            row.expires_at.map(time::iso),
        )
    } else if explicit_mode {
        let (state, strategy) = mode_to_state_strategy(&effective_mode);
        (
            state.to_string(),
            strategy.to_string(),
            "conversation".to_string(),
            mode_until,
        )
    } else {
        let (state, strategy) = mode_to_state_strategy(&effective_mode);
        (
            state.to_string(),
            strategy.to_string(),
            "default".to_string(),
            mode_until,
        )
    };
    // 紧急穿透：该联系人强制真人接待。
    if contact_flags.map(|f| f.1).unwrap_or(false) {
        state = "human".to_string();
        source = "contact".to_string();
    }

    #[derive(sqlx::FromRow)]
    struct CurrentRow {
        state: String,
        strategy: String,
        source: String,
        version: i64,
        until: Option<DateTime<Utc>>,
    }
    let current: Option<CurrentRow> = sqlx::query_as(
        "SELECT state, strategy, source, version, until FROM conversation_reception WHERE conv_id = $1 AND owner_id = $2",
    )
    .bind(conv_id)
    .bind(owner_id)
    .fetch_optional(pg)
    .await?;

    let until_dt = until
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc));

    let changed = match &current {
        Some(c) => {
            c.state != state
                || c.strategy != strategy
                || c.source != source
                || c.until != until_dt
        }
        None => true,
    };

    let version = if changed {
        current.as_ref().map(|c| c.version + 1).unwrap_or(1)
    } else {
        current.as_ref().map(|c| c.version).unwrap_or(1)
    };

    if changed {
        sqlx::query(
            r#"INSERT INTO conversation_reception (conv_id, owner_id, state, strategy, source, version, until, updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,now())
               ON CONFLICT (conv_id, owner_id) DO UPDATE
                 SET state = EXCLUDED.state,
                     strategy = EXCLUDED.strategy,
                     source = EXCLUDED.source,
                     version = EXCLUDED.version,
                     until = EXCLUDED.until,
                     updated_at = now()"#,
        )
        .bind(conv_id)
        .bind(owner_id)
        .bind(&state)
        .bind(&strategy)
        .bind(&source)
        .bind(version)
        .bind(until_dt)
        .execute(pg)
        .await?;

        let data = json!({
            "userId": owner_id,
            "convId": conv_id,
            "state": state,
            "strategy": strategy,
            "version": version,
            "fromState": current.as_ref().map(|c| c.state.clone()),
            "fromStrategy": current.as_ref().map(|c| c.strategy.clone()),
            "actorId": null,
            "actorType": "system",
            "reason": "schedule/resolve",
            "handoffUntil": null,
        });
        sqlx::query("INSERT INTO outbox (topic, key, payload) VALUES ('reception.changed', $1, $2)")
            .bind(conv_id)
            .bind(serde_json::to_value(&json!({
                "eventId": ids::new_id("evt"),
                "topic": "reception.changed",
                "key": conv_id,
                "traceId": null,
                "occurredAt": time::now_iso(),
                "data": data,
            }))?)
            .execute(pg)
            .await?;
    }

    Ok(ResolvedReception {
        view: ReceptionView {
            state,
            strategy,
            version,
            until,
            source,
            counterparty_requestable: true,
        },
        changed,
        previous_state: current.as_ref().map(|c| c.state.clone()),
        previous_strategy: current.as_ref().map(|c| c.strategy.clone()),
    })
}

/// 读取某会话中某主人的接待态（会顺带刷新投影）。
pub async fn get_reception(pg: &PgPool, conv_id: &str, owner_id: &str) -> AppResult<ReceptionView> {
    Ok(resolve_and_sync(pg, conv_id, owner_id).await?.view)
}

/// 刷新一个主人所有会话的接待投影（全局/联系人/分组变更后调用）。
pub async fn refresh_owner_conversations(
    db: &Db,
    events: &EventTx,
    owner_id: &str,
) -> AppResult<()> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT m.conv_id FROM member m JOIN principal p ON p.id = m.principal_id
         WHERE m.principal_id = $1 AND p.type = 'human'",
    )
    .bind(owner_id)
    .fetch_all(&db.pg)
    .await?;
    for (conv_id,) in rows {
        let resolved = resolve_and_sync(&db.pg, &conv_id, owner_id).await?;
        if resolved.changed {
            emit_changed(db, events, &conv_id, owner_id, &resolved).await;
        }
    }
    Ok(())
}

async fn emit_changed(
    db: &Db,
    events: &EventTx,
    conv_id: &str,
    owner_id: &str,
    resolved: &ResolvedReception,
) {
    if let Ok(recipients) = crate::message::conversation_recipients(&db.pg, conv_id).await {
        let _ = events.send(DomainEvent::ReceptionChanged {
            conv_id: conv_id.to_string(),
            owner_id: owner_id.to_string(),
            state: resolved.view.state.clone(),
            strategy: resolved.view.strategy.clone(),
            version: resolved.view.version,
            until: resolved.view.until.clone(),
            reason: None,
            recipients,
        });
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct DelegationView {
    pub id: String,
    pub owner_id: String,
    pub avatar_id: String,
    pub scope_type: String,
    pub scope_id: Option<String>,
    pub state: String,
    pub strategy: String,
    pub schedule: serde_json::Value,
    pub timezone: String,
    pub expires_at: Option<String>,
    pub revoked_at: Option<String>,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
}

async fn avatar_id_for_owner(pg: &PgPool, owner_id: &str) -> AppResult<String> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT id FROM principal WHERE owner_id = $1 AND type = 'avatar' LIMIT 1")
            .bind(owner_id)
            .fetch_optional(pg)
            .await?;
    row.map(|r| r.0)
        .ok_or_else(|| AppError::not_found("分身尚未初始化"))
}

pub async fn list_delegations(pg: &PgPool, owner_id: &str) -> AppResult<Vec<DelegationView>> {
    let rows: Vec<DelegationRowView> = sqlx::query_as(
        r#"SELECT id, owner_id, avatar_id, scope_type, scope_id, state, strategy, schedule,
                  timezone, expires_at, revoked_at, version, created_at, updated_at
           FROM delegation WHERE owner_id = $1 AND revoked_at IS NULL
           ORDER BY created_at DESC"#,
    )
    .bind(owner_id)
    .fetch_all(pg)
    .await?;
    Ok(rows.into_iter().map(DelegationRowView::into_view).collect())
}

#[derive(sqlx::FromRow)]
struct DelegationRowView {
    id: String,
    owner_id: String,
    avatar_id: String,
    scope_type: String,
    scope_id: Option<String>,
    state: String,
    strategy: String,
    schedule: serde_json::Value,
    timezone: String,
    expires_at: Option<DateTime<Utc>>,
    revoked_at: Option<DateTime<Utc>>,
    version: i64,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl DelegationRowView {
    fn into_view(self) -> DelegationView {
        DelegationView {
            id: self.id,
            owner_id: self.owner_id,
            avatar_id: self.avatar_id,
            scope_type: self.scope_type,
            scope_id: self.scope_id,
            state: self.state,
            strategy: self.strategy,
            schedule: self.schedule,
            timezone: self.timezone,
            expires_at: self.expires_at.map(time::iso),
            revoked_at: self.revoked_at.map(time::iso),
            version: self.version,
            created_at: time::iso(self.created_at),
            updated_at: time::iso(self.updated_at),
        }
    }
}

pub struct UpsertDelegation<'a> {
    pub scope_type: &'a str,
    pub scope_id: Option<&'a str>,
    pub state: &'a str,
    pub strategy: &'a str,
    pub schedule: serde_json::Value,
    pub timezone: &'a str,
    pub expires_at: Option<DateTime<Utc>>,
}

pub async fn upsert_delegation(
    db: &Db,
    events: &EventTx,
    owner_id: &str,
    input: UpsertDelegation<'_>,
    actor_id: &str,
    actor_type: &str,
    reason: &str,
) -> AppResult<DelegationView> {
    if !["global", "contact_group", "contact", "conversation"].contains(&input.scope_type) {
        return Err(AppError::bad("scopeType 不合法"));
    }
    if !["human", "avatar", "paused"].contains(&input.state) {
        return Err(AppError::bad("state 不合法"));
    }
    if ![
        "summon", "assist", "full", "screen", "decline", "escalate", "silent", "off",
    ]
    .contains(&input.strategy)
    {
        return Err(AppError::bad("strategy 不合法"));
    }
    if input.scope_type != "global" && input.scope_id.unwrap_or("").trim().is_empty() {
        return Err(AppError::bad("非全局委托必须提供 scopeId"));
    }
    let avatar_id = avatar_id_for_owner(&db.pg, owner_id).await?;
    let id = ids::new_id("dlg");
    let mut tx = db.pg.begin().await?;
    let row: DelegationRowView = sqlx::query_as(
        r#"INSERT INTO delegation
             (id, owner_id, avatar_id, scope_type, scope_id, state, strategy, schedule, timezone, expires_at, version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1)
           ON CONFLICT (owner_id, scope_type, (COALESCE(scope_id, ''))) WHERE revoked_at IS NULL
           DO UPDATE SET state = EXCLUDED.state, strategy = EXCLUDED.strategy,
                         schedule = EXCLUDED.schedule, timezone = EXCLUDED.timezone,
                         expires_at = EXCLUDED.expires_at, version = delegation.version + 1,
                         updated_at = now()
           RETURNING id, owner_id, avatar_id, scope_type, scope_id, state, strategy, schedule,
                     timezone, expires_at, revoked_at, version, created_at, updated_at"#,
    )
    .bind(&id)
    .bind(owner_id)
    .bind(&avatar_id)
    .bind(input.scope_type)
    .bind(input.scope_id)
    .bind(input.state)
    .bind(input.strategy)
    .bind(&input.schedule)
    .bind(input.timezone)
    .bind(input.expires_at)
    .fetch_one(&mut *tx)
    .await?;
    let data = json!({
        "userId": owner_id,
        "convId": null,
        "state": input.state,
        "strategy": input.strategy,
        "version": row.version,
        "fromState": null,
        "fromStrategy": null,
        "actorId": actor_id,
        "actorType": actor_type,
        "reason": reason,
        "handoffUntil": null,
    });
    outbox_insert(&mut tx, "reception.changed", owner_id, &data).await?;
    sqlx::query(
        r#"INSERT INTO delegation_event
             (owner_id, conv_id, scope_type, scope_id, actor_id, actor_type, action,
              from_state, to_state, from_strategy, to_strategy, version, reason)
           VALUES ($1,NULL,$2,$3,$4,$5,'upsert',NULL,$6,NULL,$7,$8,$9)"#,
    )
    .bind(owner_id)
    .bind(input.scope_type)
    .bind(input.scope_id)
    .bind(actor_id)
    .bind(actor_type)
    .bind(input.state)
    .bind(input.strategy)
    .bind(row.version)
    .bind(reason)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    let view = row.into_view();
    refresh_owner_conversations(db, events, owner_id).await?;
    Ok(view)
}

pub async fn revoke_delegation(
    db: &Db,
    events: &EventTx,
    owner_id: &str,
    id: &str,
) -> AppResult<()> {
    let res = sqlx::query(
        "UPDATE delegation SET revoked_at = now(), version = version + 1, updated_at = now()
         WHERE id = $1 AND owner_id = $2 AND revoked_at IS NULL",
    )
    .bind(id)
    .bind(owner_id)
    .execute(&db.pg)
    .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found("委托不存在"));
    }
    refresh_owner_conversations(db, events, owner_id).await?;
    Ok(())
}

/// 显式改变某会话的接待态：写入 conversation 级委托 + 投影 + 审计。
pub async fn set_conversation_reception(
    db: &Db,
    events: &EventTx,
    owner_id: &str,
    conv_id: &str,
    state: &str,
    strategy: &str,
    until: Option<DateTime<Utc>>,
    actor_id: &str,
    actor_type: &str,
    reason: &str,
) -> AppResult<ReceptionView> {
    crate::message::ensure_member(&db.pg, conv_id, owner_id).await?;
    if !["human", "avatar", "paused"].contains(&state) {
        return Err(AppError::bad("state 不合法"));
    }
    if ![
        "summon", "assist", "full", "screen", "decline", "escalate", "silent", "off",
    ]
    .contains(&strategy)
    {
        return Err(AppError::bad("strategy 不合法"));
    }
    let avatar_id = avatar_id_for_owner(&db.pg, owner_id).await?;

    let mut tx = db.pg.begin().await?;
    let current: Option<(String, String, i64)> = sqlx::query_as(
        "SELECT state, strategy, version FROM conversation_reception WHERE conv_id = $1 AND owner_id = $2",
    )
    .bind(conv_id)
    .bind(owner_id)
    .fetch_optional(&mut *tx)
    .await?;
    let version = current.as_ref().map(|c| c.2 + 1).unwrap_or(1);
    let handoff = if state == "human" {
        Some(Utc::now() + chrono::Duration::seconds(2))
    } else {
        None
    };

    sqlx::query(
        r#"INSERT INTO conversation_reception
             (conv_id, owner_id, state, strategy, source, version, handoff_until, until, updated_at)
           VALUES ($1,$2,$3,$4,'conversation',$5,$6,$7,now())
           ON CONFLICT (conv_id, owner_id) DO UPDATE
             SET state = EXCLUDED.state, strategy = EXCLUDED.strategy, source = 'conversation',
                 version = EXCLUDED.version, handoff_until = EXCLUDED.handoff_until,
                 until = EXCLUDED.until, updated_at = now()"#,
    )
    .bind(conv_id)
    .bind(owner_id)
    .bind(state)
    .bind(strategy)
    .bind(version)
    .bind(handoff)
    .bind(until)
    .execute(&mut *tx)
    .await?;

    let mode = strategy_to_mode(strategy);
    sqlx::query(
        "UPDATE member SET ai_mode = $3, ai_mode_source = 'explicit', ai_mode_until = $4
         WHERE conv_id = $1 AND principal_id = $2",
    )
    .bind(conv_id)
    .bind(owner_id)
    .bind(mode)
    .bind(until)
    .execute(&mut *tx)
    .await?;

    let dlg_id = ids::new_id("dlg");
    let dlg: (i64,) = sqlx::query_as(
        r#"INSERT INTO delegation
             (id, owner_id, avatar_id, scope_type, scope_id, state, strategy, expires_at, version)
           VALUES ($1,$2,$3,'conversation',$4,$5,$6,$7,1)
           ON CONFLICT (owner_id, scope_type, (COALESCE(scope_id, ''))) WHERE revoked_at IS NULL
           DO UPDATE SET state = EXCLUDED.state, strategy = EXCLUDED.strategy,
                         expires_at = EXCLUDED.expires_at, version = delegation.version + 1,
                         updated_at = now()
           RETURNING version"#,
    )
    .bind(&dlg_id)
    .bind(owner_id)
    .bind(&avatar_id)
    .bind(conv_id)
    .bind(state)
    .bind(strategy)
    .bind(until)
    .fetch_one(&mut *tx)
    .await?;

    let data = json!({
        "userId": owner_id,
        "convId": conv_id,
        "state": state,
        "strategy": strategy,
        "version": version,
        "fromState": current.as_ref().map(|c| c.0.clone()),
        "fromStrategy": current.as_ref().map(|c| c.1.clone()),
        "actorId": actor_id,
        "actorType": actor_type,
        "reason": reason,
        "handoffUntil": handoff.map(time::iso),
    });
    outbox_insert(&mut tx, "reception.changed", conv_id, &data).await?;
    sqlx::query(
        r#"INSERT INTO delegation_event
             (owner_id, conv_id, scope_type, scope_id, actor_id, actor_type, action,
              from_state, to_state, from_strategy, to_strategy, version, reason)
           VALUES ($1,$2,'conversation',$2,$3,$4,'set',$5,$6,$7,$8,$9,$10)"#,
    )
    .bind(owner_id)
    .bind(conv_id)
    .bind(actor_id)
    .bind(actor_type)
    .bind(current.as_ref().map(|c| c.0.clone()))
    .bind(state)
    .bind(current.as_ref().map(|c| c.1.clone()))
    .bind(strategy)
    .bind(version)
    .bind(reason)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    let view = ReceptionView {
        state: state.to_string(),
        strategy: strategy.to_string(),
        version,
        until: until.map(time::iso),
        source: "conversation".to_string(),
        counterparty_requestable: true,
    };
    if let Ok(recipients) = crate::message::conversation_recipients(&db.pg, conv_id).await {
        let _ = events.send(DomainEvent::ReceptionChanged {
            conv_id: conv_id.to_string(),
            owner_id: owner_id.to_string(),
            state: state.to_string(),
            strategy: strategy.to_string(),
            version,
            until: until.map(time::iso),
            reason: Some(reason.to_string()),
            recipients,
        });
    }
    let _ = dlg;
    Ok(view)
}

/// 一键接管：同步写权威 + 版本递增 + 交接窗口；outbox 仅负责任务取消与通知。
pub async fn takeover(
    db: &Db,
    events: &EventTx,
    user_id: &str,
    conv_id: &str,
) -> AppResult<ReceptionView> {
    let current = get_reception(&db.pg, conv_id, user_id).await?;
    set_conversation_reception(
        db,
        events,
        user_id,
        conv_id,
        "human",
        &current.strategy,
        None,
        user_id,
        "owner",
        "主人接管",
    )
    .await
}

/// 交还分身：恢复为分身接待，保留当前策略。
pub async fn release(
    db: &Db,
    events: &EventTx,
    user_id: &str,
    conv_id: &str,
) -> AppResult<ReceptionView> {
    let current = get_reception(&db.pg, conv_id, user_id).await?;
    set_conversation_reception(
        db,
        events,
        user_id,
        conv_id,
        "avatar",
        &current.strategy,
        None,
        user_id,
        "owner",
        "交还分身",
    )
    .await
}

/// 对端请求真人：限流后落库并通知主人（不直接切换）。
pub async fn request_human(
    db: &Db,
    _events: &EventTx,
    requester_id: &str,
    conv_id: &str,
    reason: Option<&str>,
) -> AppResult<String> {
    crate::message::ensure_member(&db.pg, conv_id, requester_id).await?;
    let owner: Option<(String,)> = sqlx::query_as(
        r#"SELECT m.principal_id FROM member m
           JOIN principal p ON p.id = m.principal_id
           JOIN conversation c ON c.id = m.conv_id
           WHERE m.conv_id = $1 AND c.type = 'direct' AND c.system_tag IS NULL
             AND p.type = 'human' AND m.principal_id <> $2
           LIMIT 1"#,
    )
    .bind(conv_id)
    .bind(requester_id)
    .fetch_optional(&db.pg)
    .await?;
    let owner_id = owner
        .map(|r| r.0)
        .ok_or_else(|| AppError::bad("当前会话没有可请求的对方主人"))?;

    let recent: Option<(i64,)> = sqlx::query_as(
        "SELECT count(*) FROM human_request
         WHERE conv_id = $1 AND requester_id = $2 AND created_at > now() - interval '30 minutes'",
    )
    .bind(conv_id)
    .bind(requester_id)
    .fetch_optional(&db.pg)
    .await?;
    if recent.unwrap_or((0,)).0 > 0 {
        return Err(AppError::conflict("请求过于频繁，请稍后再试"));
    }

    let request_id = ids::new_id("req");
    let expires_at = Utc::now() + chrono::Duration::minutes(30);
    let mut tx = db.pg.begin().await?;
    sqlx::query(
        "INSERT INTO human_request (id, conv_id, owner_id, requester_id, reason, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(&request_id)
    .bind(conv_id)
    .bind(&owner_id)
    .bind(requester_id)
    .bind(reason)
    .bind(expires_at)
    .execute(&mut *tx)
    .await?;
    let data = json!({
        "requestId": request_id,
        "convId": conv_id,
        "ownerId": owner_id,
        "requesterId": requester_id,
        "reason": reason,
        "expiresAt": time::iso(expires_at),
    });
    outbox_insert(&mut tx, "human.requested", conv_id, &data).await?;
    tx.commit().await?;
    tracing::info!(conv_id, requester_id, owner_id, "human request created");
    Ok(request_id)
}

pub async fn resolve_human_request(
    db: &Db,
    events: &EventTx,
    owner_id: &str,
    request_id: &str,
    approve: bool,
) -> AppResult<()> {
    #[derive(sqlx::FromRow)]
    struct ReqRow {
        conv_id: String,
        status: String,
    }
    let req: Option<ReqRow> = sqlx::query_as(
        "SELECT conv_id, status FROM human_request WHERE id = $1 AND owner_id = $2",
    )
    .bind(request_id)
    .bind(owner_id)
    .fetch_optional(&db.pg)
    .await?;
    let req = req.ok_or_else(|| AppError::not_found("请求不存在"))?;
    if req.status != "pending" {
        return Ok(());
    }
    sqlx::query(
        "UPDATE human_request SET status = $3, resolved_at = now()
         WHERE id = $1 AND owner_id = $2 AND status = 'pending'",
    )
    .bind(request_id)
    .bind(owner_id)
    .bind(if approve { "granted" } else { "declined" })
    .execute(&db.pg)
    .await?;

    if approve {
        let current = get_reception(&db.pg, &req.conv_id, owner_id).await?;
        set_conversation_reception(
            db,
            events,
            owner_id,
            &req.conv_id,
            "human",
            &current.strategy,
            None,
            owner_id,
            "owner",
            "批准请求真人",
        )
        .await?;
    }
    Ok(())
}

/// 联系人标签更新后刷新该主人所有会话。
pub async fn set_contact_tags(
    db: &Db,
    events: &EventTx,
    owner_id: &str,
    peer_id: &str,
    tags: &[String],
) -> AppResult<()> {
    let mut tx = db.pg.begin().await?;
    sqlx::query("DELETE FROM contact_tag_member WHERE user_id = $1 AND peer_id = $2")
        .bind(owner_id)
        .bind(peer_id)
        .execute(&mut *tx)
        .await?;
    for tag in tags {
        let tag = tag.trim();
        if tag.is_empty() {
            continue;
        }
        sqlx::query("INSERT INTO contact_tag (user_id, tag) VALUES ($1,$2) ON CONFLICT DO NOTHING")
            .bind(owner_id)
            .bind(tag)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "INSERT INTO contact_tag_member (user_id, tag, peer_id) VALUES ($1,$2,$3)
             ON CONFLICT DO NOTHING",
        )
        .bind(owner_id)
        .bind(tag)
        .bind(peer_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    refresh_owner_conversations(db, events, owner_id).await?;
    Ok(())
}

pub async fn contact_tags_for(pg: &PgPool, owner_id: &str, peer_id: &str) -> AppResult<Vec<String>> {
    contact_tags(pg, owner_id, peer_id).await
}

/// 发送路径围栏：在事务内读取投影并校验版本/交接窗口。
pub async fn enforce_avatar_send(
    tx: &mut Transaction<'_, Postgres>,
    conv_id: &str,
    owner_id: &str,
    authority_version: i64,
    via: Option<&str>,
) -> AppResult<()> {
    let row: Option<(String, i64, Option<DateTime<Utc>>)> = sqlx::query_as(
        "SELECT state, version, handoff_until FROM conversation_reception
         WHERE conv_id = $1 AND owner_id = $2",
    )
    .bind(conv_id)
    .bind(owner_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some((state, version, handoff_until)) = row else {
        return Err(AppError::forbidden("AUTHORITY_MISSING: 接待态尚未初始化"));
    };
    let bypass = matches!(
        via,
        Some("mention") | Some("self_chat") | Some("owner_approved") | Some("internal_card")
    );
    if state != "avatar" && !bypass {
        return Err(AppError::forbidden("AUTHORITY_REVOKED: 当前由真人接待"));
    }
    if let Some(until) = handoff_until {
        if until > Utc::now() && !bypass {
            return Err(AppError::conflict("HANDOFF_WINDOW: 正在交接，请稍后"));
        }
    }
    if authority_version > 0 && authority_version != version && !bypass {
        return Err(AppError::conflict(format!(
            "AUTHORITY_STALE: 授权版本已变化（当前 {version}）"
        )));
    }
    Ok(())
}

/// 真人发送消息时的自动接管：私聊中默认由真人接管 15 分钟。
pub async fn human_interjection(
    tx: &mut Transaction<'_, Postgres>,
    conv_id: &str,
    owner_id: &str,
    conv_type: &str,
    system_tag: Option<&str>,
) -> AppResult<()> {
    if conv_type != "direct" || system_tag.is_some() {
        return Ok(());
    }
    let row: Option<(String, String, i64)> = sqlx::query_as(
        "SELECT state, strategy, version FROM conversation_reception
         WHERE conv_id = $1 AND owner_id = $2",
    )
    .bind(conv_id)
    .bind(owner_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some((state, strategy, version)) = row else {
        return Ok(());
    };
    if state != "avatar" {
        return Ok(());
    }
    let handoff = Utc::now() + chrono::Duration::seconds(2);
    let until = Utc::now() + chrono::Duration::minutes(15);
    sqlx::query(
        "UPDATE conversation_reception
         SET state = 'human', version = version + 1, handoff_until = $3, until = $4, updated_at = now()
         WHERE conv_id = $1 AND owner_id = $2",
    )
    .bind(conv_id)
    .bind(owner_id)
    .bind(handoff)
    .bind(until)
    .execute(&mut **tx)
    .await?;

    // 持久化为会话级临时委托，避免下一次解析被显式 auto 档覆盖。
    let avatar_id: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM principal WHERE owner_id = $1 AND type = 'avatar' LIMIT 1",
    )
    .bind(owner_id)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some((avatar_id,)) = avatar_id {
        let dlg_id = ids::new_id("dlg");
        sqlx::query(
            r#"INSERT INTO delegation
                 (id, owner_id, avatar_id, scope_type, scope_id, state, strategy, expires_at, version)
               VALUES ($1,$2,$3,'conversation',$4,'human',$5,$6,1)
               ON CONFLICT (owner_id, scope_type, (COALESCE(scope_id, ''))) WHERE revoked_at IS NULL
               DO UPDATE SET state = 'human', strategy = EXCLUDED.strategy,
                             expires_at = EXCLUDED.expires_at, version = delegation.version + 1,
                             updated_at = now()"#,
        )
        .bind(&dlg_id)
        .bind(owner_id)
        .bind(&avatar_id)
        .bind(conv_id)
        .bind(&strategy)
        .bind(until)
        .execute(&mut **tx)
        .await?;
        sqlx::query(
            r#"INSERT INTO delegation_event
                 (owner_id, conv_id, scope_type, scope_id, actor_id, actor_type, action,
                  from_state, to_state, from_strategy, to_strategy, version, reason)
               VALUES ($1,$2,'conversation',$2,$1,'owner','auto_takeover',
                       $3,'human',$4,$4,$5,'真人发言自动接管')"#,
        )
        .bind(owner_id)
        .bind(conv_id)
        .bind(&state)
        .bind(&strategy)
        .bind(version + 1)
        .execute(&mut **tx)
        .await?;
    }
    // 让 AI 取消进行中的任务；版本围栏保证即使事件延迟也不会漏发。
    let data = json!({
        "userId": owner_id,
        "convId": conv_id,
        "state": "human",
        "strategy": strategy,
        "version": version + 1,
        "fromState": state,
        "fromStrategy": strategy,
        "actorId": owner_id,
        "actorType": "owner",
        "reason": "真人发言自动接管",
        "handoffUntil": time::iso(handoff),
    });
    outbox_insert(tx, "reception.changed", conv_id, &data).await?;
    outbox_insert(
        tx,
        "takeover.requested",
        conv_id,
        &json!({ "userId": owner_id, "convId": conv_id }),
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_mode_mapping_is_stable() {
        assert_eq!(mode_to_state_strategy("auto"), ("avatar", "full"));
        assert_eq!(mode_to_state_strategy("draft"), ("human", "assist"));
        assert_eq!(mode_to_state_strategy("off"), ("human", "off"));
        assert_eq!(mode_to_state_strategy("manual"), ("human", "summon"));
    }

    #[test]
    fn strategy_maps_back_to_mode() {
        assert_eq!(strategy_to_mode("full"), "auto");
        assert_eq!(strategy_to_mode("screen"), "auto");
        assert_eq!(strategy_to_mode("assist"), "draft");
        assert_eq!(strategy_to_mode("off"), "off");
        assert_eq!(strategy_to_mode("summon"), "manual");
    }

    #[test]
    fn empty_schedule_matches_always() {
        assert!(in_schedule_window(&[], Utc::now()));
    }

    #[test]
    fn cross_midnight_window_is_parsed() {
        let windows = vec![ScheduleWindow {
            days: vec![],
            start: "22:00".into(),
            end: "08:00".into(),
        }];
        // 只验证解析不 panic；具体命中依赖当前本地时间。
        let _ = in_schedule_window(&windows, Utc::now());
    }
}
