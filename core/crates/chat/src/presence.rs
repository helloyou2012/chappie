//! presence：在线与输入状态（Redis 加速层，TTL 见设计方案 §37.1）。
//! 路由 key：core:presence:{uid}（90s 心跳续期）、core:typing:{conv}:{uid}（5s）。

use im_core_common::AppResult;
use im_core_store::{redis_keys, Db};
use redis::AsyncCommands;
use serde::Serialize;

pub struct PresenceInfo {
    pub user_id: String,
    pub online: bool,
    pub typing_conv_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceApi {
    pub user_id: String,
    pub online: bool,
    pub typing_conv_id: Option<String>,
}

pub async fn set_online(db: &Db, user_id: &str) {
    let _: Result<(), _> = db.redis.clone().set_ex(redis_keys::PRESENCE(user_id), "1", 90).await;
}

pub async fn heartbeat(db: &Db, user_id: &str) {
    let _: Result<(), _> = db.redis.clone().set_ex(redis_keys::PRESENCE(user_id), "1", 90).await;
}

pub async fn set_offline(db: &Db, user_id: &str) {
    let _: Result<(), _> = db.redis.clone().del(redis_keys::PRESENCE(user_id)).await;
}

pub async fn set_typing(db: &Db, conv_id: &str, user_id: &str) {
    let _: Result<(), _> = db
        .redis
        .clone()
        .set_ex(redis_keys::TYPING(conv_id, user_id), "1", 5)
        .await;
}

pub async fn is_online(db: &Db, user_id: &str) -> bool {
    db.redis
        .clone()
        .exists::<_, bool>(redis_keys::PRESENCE(user_id))
        .await
        .unwrap_or(false)
}

/// 批量 presence（内部 GetPresence：让位判断用 —— 设计方案 §4.3/§25.5）
pub async fn get_presences(db: &Db, user_ids: &[String]) -> AppResult<Vec<PresenceApi>> {
    let mut conn = db.redis.clone();
    let mut out = Vec::with_capacity(user_ids.len());
    for uid in user_ids {
        let online: bool = conn
            .exists(redis_keys::PRESENCE(uid))
            .await
            .unwrap_or(false);
        let typing_conv_id = if online {
            typing_conv_of(&mut conn, uid).await
        } else {
            None
        };
        out.push(PresenceApi { user_id: uid.clone(), online, typing_conv_id });
    }
    Ok(out)
}

/// 查询用户当前正在输入的会话（SCAN 替代 KEYS —— §37.2 命令白名单）
async fn typing_conv_of(conn: &mut redis::aio::ConnectionManager, uid: &str) -> Option<String> {
    let pattern = format!("core:typing:*:{uid}");
    let mut cursor: u64 = 0;
    loop {
        let (next, keys): (u64, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor)
            .arg("MATCH")
            .arg(&pattern)
            .arg("COUNT")
            .arg(50)
            .query_async(conn)
            .await
            .ok()?;
        if let Some(key) = keys.first() {
            // core:typing:{conv}:{uid}
            let parts: Vec<&str> = key.split(':').collect();
            return parts.get(2).map(|s| s.to_string());
        }
        if next == 0 {
            return None;
        }
        cursor = next;
    }
}
