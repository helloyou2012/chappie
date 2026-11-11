//! 邮箱 + 验证码登录（设计方案 §28.3）。
//! 验证码与令牌存 Redis（core: 命名空间，带 TTL —— §37.1）。

use im_core_common::{ids, time, AppError, AppResult, Config, EmailSender};
use im_core_store::{redis_keys, Db};
use redis::AsyncCommands;
use serde_json::json;
use sqlx::PgPool;

use crate::model::{User, UserApi};

const TOKEN_TTL_SECONDS: u64 = 30 * 24 * 3600;
const CODE_SEND_LIMIT_PER_HOUR: i64 = 5;

pub struct AuthCodeResult {
    /// 仅 AUTH_CODE_DEV_ECHO=true 时返回（本地演示）
    pub dev_code: Option<String>,
    pub expires_in: i64,
}

fn normalize(email: &str) -> String {
    email.trim().to_lowercase()
}

pub async fn send_code(db: &Db, cfg: &Config, email: &str) -> AppResult<AuthCodeResult> {
    let email = normalize(email);

    // 发送限流：每邮箱每小时 5 次
    let rl_key = redis_keys::AUTH_CODE_RL(&email);
    let count: i64 = redis::cmd("INCR")
        .arg(&rl_key)
        .query_async(&mut db.redis.clone())
        .await
        .unwrap_or(1);
    if count == 1 {
        let _ = db
            .redis
            .clone()
            .expire::<_, ()>(&rl_key, 3600)
            .await;
    }
    if count > CODE_SEND_LIMIT_PER_HOUR {
        return Err(AppError::RateLimited("验证码发送过于频繁，请 1 小时后再试".into()));
    }

    let code = ids::new_auth_code();
    let code_key = redis_keys::AUTH_CODE(&email);
    let _: () = db
        .redis
        .clone()
        .set_ex(code_key, &code, cfg.auth_code_ttl_seconds)
        .await?;

    EmailSender::from_config(&cfg.resend_api_key, &cfg.mail_from)
        .send_code(&email, &code)
        .await;

    Ok(AuthCodeResult {
        dev_code: cfg.auth_code_dev_echo.then_some(code),
        expires_in: cfg.auth_code_ttl_seconds as i64,
    })
}

pub async fn verify_code(db: &Db, _cfg: &Config, email: &str, code: &str) -> AppResult<(String, UserApi, String)> {
    let email = normalize(email);
    let code_key = redis_keys::AUTH_CODE(&email);
    let stored: Option<String> = db.redis.clone().get(code_key).await?;
    let stored = stored.ok_or_else(|| AppError::bad("验证码已过期，请重新获取"))?;
    if !stored.eq_ignore_ascii_case(code.trim()) {
        return Err(AppError::bad("验证码错误"));
    }
    let _: () = db.redis.clone().del(redis_keys::AUTH_CODE(&email)).await?;

    // 首次登录即注册；user.created 事件由 Bun 消费（创建 avatar + 默认策略 + 分身会话）
    let user = match find_by_email(&db.pg, &email).await? {
        Some(u) => u,
        None => create_user(&db, &email).await?,
    };

    let token = ids::new_token();
    let _: () = db
        .redis
        .clone()
        .set_ex(redis_keys::AUTH_TOKEN(&token), &user.id, TOKEN_TTL_SECONDS)
        .await?;
    let expires_at = time::iso(time::now() + chrono::Duration::seconds(TOKEN_TTL_SECONDS as i64));
    Ok((token, user.to_api(), expires_at))
}

pub async fn verify_token(db: &Db, token: &str) -> AppResult<String> {
    let uid: Option<String> = db.redis.clone().get(redis_keys::AUTH_TOKEN(token)).await?;
    uid.ok_or_else(|| AppError::unauthorized("登录已过期，请重新登录"))
}

pub async fn logout(db: &Db, token: &str) -> AppResult<()> {
    let _: () = db.redis.clone().del(redis_keys::AUTH_TOKEN(token)).await?;
    Ok(())
}

async fn find_by_email(pg: &PgPool, email: &str) -> AppResult<Option<User>> {
    let user = sqlx::query_as::<_, User>("SELECT * FROM \"user\" WHERE email = $1")
        .bind(email)
        .fetch_optional(pg)
        .await?;
    Ok(user)
}

async fn create_user(db: &Db, email: &str) -> AppResult<User> {
    let name = email.split('@').next().unwrap_or("用户").to_string();
    let mut tx = db.pg.begin().await?;
    let uid = ids::new_user_id();

    sqlx::query("INSERT INTO principal (id, type, name) VALUES ($1, 'human', $2)")
        .bind(&uid)
        .bind(&name)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO \"user\" (id, email, name) VALUES ($1, $2, $3)")
        .bind(&uid)
        .bind(email)
        .bind(&name)
        .execute(&mut *tx)
        .await?;

    // outbox：user.created（同事务 —— 事件不丢）
    let payload = json!({
        "eventId": ids::new_id("evt"),
        "topic": "user.created",
        "key": uid,
        "traceId": null,
        "occurredAt": time::now_iso(),
        "data": { "userId": uid, "email": email, "name": name },
    });
    sqlx::query("INSERT INTO outbox (topic, key, payload) VALUES ('user.created', $1, $2)")
        .bind(&uid)
        .bind(&payload)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    tracing::info!(user_id = %uid, email, "new user registered");

    let user = sqlx::query_as::<_, User>("SELECT * FROM \"user\" WHERE id = $1")
        .bind(&uid)
        .fetch_one(&db.pg)
        .await?;
    Ok(user)
}

pub async fn register_device(db: &Db, user_id: &str, device_id: &str, platform: &str, push_token: Option<&str>) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO device (user_id, device_id, platform, push_token, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (user_id, device_id) DO UPDATE SET platform = $3, push_token = $4, updated_at = now()",
    )
    .bind(user_id)
    .bind(device_id)
    .bind(platform)
    .bind(push_token)
    .execute(&db.pg)
    .await?;
    // TODO(生产): push_token 到达时接入 APNs / FCM / 厂商通道（设计方案 §25.1 push crate 预留）
    Ok(())
}
