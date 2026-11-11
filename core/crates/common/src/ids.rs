//! ID 与随机串生成。前缀规则与契约包 identity.ts 对齐：
//! human → u_ / avatar → a_ / conversation → c_ / message → m_

use rand::Rng;

pub fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}", uuid::Uuid::new_v4())
}

pub fn new_user_id() -> String {
    new_id("u")
}
pub fn new_avatar_id() -> String {
    new_id("a")
}
pub fn new_conv_id() -> String {
    new_id("c")
}
pub fn new_msg_id() -> String {
    new_id("m")
}

/// 登录令牌：64 字符 hex
pub fn new_token() -> String {
    hex(rand::thread_rng().gen::<[u8; 32]>())
}

/// 6 位数字验证码（首位非 0，避免前导丢失的展示问题）
pub fn new_auth_code() -> String {
    let mut rng = rand::thread_rng();
    let code: u32 = rng.gen_range(100_000..1_000_000);
    code.to_string()
}

pub fn hex(bytes: impl AsRef<[u8]>) -> String {
    hex::encode(bytes)
}
