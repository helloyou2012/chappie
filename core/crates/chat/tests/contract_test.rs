//! 契约测试：读取 packages/contract 导出的 fixtures.json，
//! 对每个样例做 serde 反序列化 + 回序列化，与原 JSON 语义相等。
//! 与 TS 侧 bun test 共用同一数据源，防止两侧类型漂移（见契约包 README）。

use im_core_chat::{Content, Conversation, Message, UserApi};
use serde::de::DeserializeOwned;
use serde::Serialize;

fn fixtures() -> serde_json::Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/contract/fixtures.json"
    );
    let raw = std::fs::read_to_string(path)
        .expect("fixtures.json 不存在：先运行 pnpm --filter @chappie/contract export:fixtures");
    serde_json::from_str(&raw).expect("fixtures.json 解析失败")
}

fn roundtrip<T: DeserializeOwned + Serialize>(value: &serde_json::Value, name: &str) {
    let parsed: T = serde_json::from_value(value.clone())
        .unwrap_or_else(|e| panic!("[{name}] Rust 反序列化失败（契约漂移？）: {e}"));
    let back = serde_json::to_value(&parsed).unwrap();
    assert_json_eq(value, &back, name);
}

fn assert_json_eq(expected: &serde_json::Value, actual: &serde_json::Value, path: &str) {
    match (expected, actual) {
        (serde_json::Value::Object(a), serde_json::Value::Object(b)) => {
            for (k, v) in a {
                let bv = b
                    .get(k)
                    .unwrap_or_else(|| panic!("[{path}] Rust 序列化缺少字段 {k}"));
                assert_json_eq(v, bv, &format!("{path}.{k}"));
            }
            for k in b.keys() {
                assert!(
                    a.contains_key(k),
                    "[{path}] Rust 序列化多出字段 {k}（契约未定义，需先在契约包登记）"
                );
            }
        }
        (_, _) => {
            assert!(
                expected == actual,
                "[{path}] 字段值不一致: 期望 {expected}，实际 {actual}"
            );
        }
    }
}

#[test]
fn message_fixtures_roundtrip() {
    let fx = fixtures();
    for key in [
        "humanMessage",
        "avatarMessage",
        "draftCardMessage",
        "approvalCardMessage",
        "taskCardMessage",
    ] {
        roundtrip::<Message>(&fx[key], key);
    }
}

#[test]
fn content_standalone_roundtrip() {
    let fx = fixtures();
    roundtrip::<Content>(&fx["humanMessage"]["content"], "humanMessage.content");
    roundtrip::<Content>(&fx["draftCardMessage"]["content"], "draftCardMessage.content");
}

#[test]
fn identity_and_conversation_roundtrip() {
    let fx = fixtures();
    roundtrip::<UserApi>(&fx["user"], "user");
    roundtrip::<Conversation>(&fx["conversation"], "conversation");
}

#[test]
fn unknown_content_type_is_rejected_not_silently_accepted() {
    // 契约纪律：未知 content.type 在 Rust 侧应显式失败，而不是被吞掉
    let unknown = serde_json::json!({ "type": "vote", "schemaVersion": 1 });
    let result = serde_json::from_value::<Content>(unknown);
    assert!(result.is_err());
}
