//! 领域模型（serde 结构）。
//!
//! 与 packages/contract 的 zod schema 逐字段对齐（camelCase）；
//! `tests/contract_test.rs` 用契约包导出的 fixtures.json 做往返校验防漂移。
//! 契约纪律：字段只加不改；新内容类型只增 Content 分支。

use im_core_common::time;
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// 身份
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Principal {
    pub id: String,
    /// DB 列名为 `type`；JSON 字段名为 `type`（camelCase 不变）
    #[serde(rename = "type")]
    #[sqlx(rename = "type")]
    pub principal_type: String,
    #[serde(default)]
    pub owner_id: Option<String>,
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_status")]
    pub status: String,
}

fn default_status() -> String {
    "active".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl User {
    pub fn to_api(&self) -> UserApi {
        UserApi {
            id: self.id.clone(),
            email: self.email.clone(),
            name: self.name.clone(),
            avatar_url: self.avatar_url.clone(),
            created_at: time::iso(self.created_at),
        }
    }
}

/// 对外 User（createdAt 为 ISO 字符串，对齐契约）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserApi {
    pub id: String,
    pub email: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub created_at: String,
}

// ---------------------------------------------------------------------------
// 消息内容（Content 注册表：text | image | file | card —— 只增不改）
// ---------------------------------------------------------------------------

fn default_schema_version() -> i32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Content {
    Text {
        #[serde(default = "default_schema_version")]
        schema_version: i32,
        text: String,
    },
    Image {
        #[serde(default = "default_schema_version")]
        schema_version: i32,
        url: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        width: Option<i32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        height: Option<i32>,
    },
    File {
        #[serde(default = "default_schema_version")]
        schema_version: i32,
        url: String,
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        size: Option<i32>,
    },
    Card {
        #[serde(default = "default_schema_version")]
        schema_version: i32,
        card: CardPayload,
    },
}

impl Content {
    /// 单行预览文本（会话列表 / 通知用）
    pub fn preview(&self) -> String {
        match self {
            Content::Text { text, .. } => {
                let t = text.replace('\n', " ");
                if t.chars().count() > 60 {
                    t.chars().take(60).collect::<String>() + "…"
                } else {
                    t
                }
            }
            Content::Image { .. } => "[图片]".into(),
            Content::File { name, .. } => format!("[文件] {name}"),
            Content::Card { card, .. } => card.preview(),
        }
    }
}

/// 卡片：draft | approval | task | handover | report（设计方案 §5.2）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum CardPayload {
    Draft {
        task_id: String,
        draft_text: String,
        #[serde(default)]
        reason: String,
        target_conv_id: String,
        #[serde(default)]
        reply_to_msg_id: Option<String>,
        #[serde(default)]
        expires_at: Option<String>,
    },
    Approval {
        approval_id: String,
        task_id: String,
        title: String,
        summary: String,
        tool_name: String,
        #[serde(default)]
        args: serde_json::Map<String, serde_json::Value>,
        risk: String,
        #[serde(default)]
        expires_at: Option<String>,
    },
    Task {
        task_id: String,
        title: String,
        status: String,
        #[serde(default)]
        steps: Vec<TaskCardStep>,
    },
    Handover {
        task_id: String,
        summary: String,
        #[serde(default)]
        reason: String,
    },
    Report {
        report_id: String,
        day: String,
        summary: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCardStep {
    pub name: String,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl CardPayload {
    pub fn preview(&self) -> String {
        match self {
            CardPayload::Draft { .. } => "[草稿卡片]".into(),
            CardPayload::Approval { title, .. } => format!("[待确认] {title}"),
            CardPayload::Task { title, status, .. } => {
                let icon = match status.as_str() {
                    "completed" => "✅",
                    "failed" => "❌",
                    "cancelled" => "🚫",
                    _ => "⏳",
                };
                format!("{icon} [任务] {title}")
            }
            CardPayload::Handover { .. } => "[转交给你]".into(),
            CardPayload::Report { day, .. } => format!("[分身日报] {day}"),
        }
    }
}

// ---------------------------------------------------------------------------
// AI 元信息
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Explanation {
    pub decision: String,
    pub reason: String,
    pub confidence: f64,
    #[serde(default)]
    pub tools_used: Vec<String>,
    #[serde(default)]
    pub memories_used: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiMeta {
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub tools_used: Vec<String>,
    #[serde(default)]
    pub risk: Option<String>,
    #[serde(default)]
    pub confidence: Option<f64>,
    #[serde(default)]
    pub hop_count: u32,
    #[serde(default)]
    pub explanation: Option<Explanation>,
}

// ---------------------------------------------------------------------------
// 消息
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub msg_id: String,
    pub conv_id: String,
    pub seq: i64,
    pub sender_id: String,
    pub sender_type: String,
    #[serde(default)]
    pub on_behalf_of: Option<String>,
    pub content: Content,
    #[serde(default)]
    pub mentions: Vec<String>,
    #[serde(default)]
    pub reply_to: Option<String>,
    #[serde(default)]
    pub ai_meta: Option<AiMeta>,
    #[serde(default)]
    pub recalled: bool,
    pub created_at: String,
}

/// 消息表行（读路径转换成 Message；撤回消息内容替换为占位）
#[derive(Debug, sqlx::FromRow)]
pub struct MessageRow {
    pub msg_id: String,
    pub conv_id: String,
    pub seq: i64,
    pub sender_id: String,
    pub sender_type: String,
    pub on_behalf_of: Option<String>,
    pub content: serde_json::Value,
    pub mentions: Option<Vec<String>>,
    pub reply_to: Option<String>,
    pub ai_meta: Option<serde_json::Value>,
    pub recalled: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl TryFrom<MessageRow> for Message {
    type Error = im_core_common::AppError;

    fn try_from(row: MessageRow) -> Result<Self, Self::Error> {
        let (content, ai_meta) = if row.recalled {
            (
                Content::Text { schema_version: 1, text: "消息已撤回".into() },
                None,
            )
        } else {
            (
                serde_json::from_value(row.content)?,
                row.ai_meta
                    .map(serde_json::from_value::<AiMeta>)
                    .transpose()?,
            )
        };
        Ok(Message {
            msg_id: row.msg_id,
            conv_id: row.conv_id,
            seq: row.seq,
            sender_id: row.sender_id,
            sender_type: row.sender_type,
            on_behalf_of: row.on_behalf_of,
            content,
            mentions: row.mentions.unwrap_or_default(),
            reply_to: row.reply_to,
            ai_meta,
            recalled: row.recalled,
            created_at: time::iso(row.created_at),
        })
    }
}

// ---------------------------------------------------------------------------
// 会话与成员
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    #[serde(rename = "type")]
    pub conv_type: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub system_tag: Option<String>,
    pub last_seq: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberView {
    pub principal_id: String,
    pub principal_type: String,
    #[serde(default)]
    pub owner_id: Option<String>,
    pub name: String,
    pub role: String,
    pub ai_mode: String,
    #[serde(default)]
    pub ai_mode_until: Option<String>,
    pub last_read_seq: i64,
    pub online: bool,
}

/// GET /conversations 返回的会话视图
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationView {
    pub conversation: Conversation,
    pub my_principal_id: String,
    pub my_role: String,
    pub my_ai_mode: String,
    pub my_ai_mode_until: Option<String>,
    pub my_last_read_seq: i64,
    pub unread_count: i64,
    pub display_title: String,
    pub last_msg_preview: Option<String>,
    pub last_msg_at: Option<String>,
    pub last_msg_sender_id: Option<String>,
}

// ---------------------------------------------------------------------------
// WebSocket 帧（对齐 packages/contract/src/frames.ts）
// ---------------------------------------------------------------------------

fn default_pull_limit() -> i64 {
    50
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ClientFrame {
    Auth {
        token: String,
        #[serde(default = "default_platform")]
        platform: String,
        #[serde(default)]
        device_id: Option<String>,
    },
    Heartbeat {
        #[allow(dead_code)]
        ts: i64,
    },
    SendMessage {
        client_msg_id: String,
        conv_id: String,
        content: Content,
        #[serde(default)]
        mentions: Vec<String>,
        #[serde(default)]
        reply_to: Option<String>,
    },
    Typing {
        conv_id: String,
    },
    MarkRead {
        conv_id: String,
        seq: i64,
    },
    RecallMessage {
        msg_id: String,
    },
    PullMessages {
        conv_id: String,
        from_seq: i64,
        #[serde(default = "default_pull_limit")]
        limit: i64,
    },
}

fn default_platform() -> String {
    "web".into()
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ServerFrame {
    AuthOk {
        user: UserApi,
        server_time: String,
    },
    AuthError {
        message: String,
    },
    HeartbeatAck {
        ts: i64,
    },
    MessageCreated {
        message: Message,
    },
    MessageAcked {
        client_msg_id: String,
        msg_id: String,
        seq: i64,
        server_time: String,
    },
    MessageRecalled {
        conv_id: String,
        msg_id: String,
    },
    MessageUpdated {
        message: Message,
    },
    MessagesBatch {
        conv_id: String,
        messages: Vec<Message>,
        has_more: bool,
    },
    Typing {
        conv_id: String,
        principal_id: String,
        until_ts: i64,
    },
    Presence {
        principal_id: String,
        online: bool,
    },
    ReadSync {
        conv_id: String,
        principal_id: String,
        last_read_seq: i64,
    },
    ConversationsChanged,
    Error {
        code: String,
        message: String,
    },
}
