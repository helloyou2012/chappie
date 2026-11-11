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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_id_has_prefix_and_uuid() {
        let id = new_id("t");
        assert!(id.starts_with("t_"));
        let uuid_part = &id[2..];
        assert_eq!(uuid_part.len(), 36);
        assert!(uuid::Uuid::parse_str(uuid_part).is_ok());
    }

    #[test]
    fn ids_are_unique() {
        assert_ne!(new_user_id(), new_user_id());
        assert_ne!(new_avatar_id(), new_avatar_id());
        assert_ne!(new_conv_id(), new_conv_id());
        assert_ne!(new_msg_id(), new_msg_id());
    }

    #[test]
    fn token_is_64_hex_chars() {
        let token = new_token();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn auth_code_is_six_digits_without_leading_zero() {
        for _ in 0..64 {
            let code = new_auth_code();
            assert_eq!(code.len(), 6);
            assert!(!code.starts_with('0'));
            assert!(code.parse::<u32>().is_ok());
        }
    }
}
