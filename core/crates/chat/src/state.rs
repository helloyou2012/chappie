//! AppState：im-core 全局共享状态（gateway 与 internal-api 共用）。

use std::collections::HashMap;
use std::sync::RwLock;

use im_core_common::Config;
use im_core_store::Db;
use tokio::sync::mpsc;

use crate::events::EventTx;

/// 每连接一个无界…… 不 —— 有界发送队列（背压：超限断开重连补洞，设计方案 §25.3）
pub type ConnTx = mpsc::Sender<String>;

#[derive(Default)]
pub struct ConnectionRegistry {
    /// user_id → 各连接的发送端
    inner: RwLock<HashMap<String, Vec<ConnTx>>>,
}

impl ConnectionRegistry {
    pub fn register(&self, user_id: &str, tx: ConnTx) -> usize {
        let mut map = self.inner.write().unwrap();
        let list = map.entry(user_id.to_string()).or_default();
        list.push(tx);
        list.len()
    }

    /// 返回该用户剩余连接数
    pub fn unregister(&self, user_id: &str, dropped: &ConnTx) -> usize {
        let mut map = self.inner.write().unwrap();
        if let Some(list) = map.get_mut(user_id) {
            let ptr = dropped as *const _ as usize;
            list.retain(|tx| tx as *const _ as usize != ptr);
            if list.is_empty() {
                map.remove(user_id);
                return 0;
            }
            return list.len();
        }
        0
    }

    pub fn send_to_user(&self, user_id: &str, json: &str) {
        if let Some(list) = self.inner.read().unwrap().get(user_id) {
            for tx in list {
                // 队列满（try_send 失败）→ 丢弃该连接，由客户端重连 + seq 补洞兜底
                let _ = tx.try_send(json.to_string());
            }
        }
    }

    pub fn send_to_users(&self, user_ids: &[String], json: &str) {
        for uid in user_ids {
            self.send_to_user(uid, json);
        }
    }

    pub fn online_count(&self, user_id: &str) -> usize {
        self.inner.read().unwrap().get(user_id).map(|l| l.len()).unwrap_or(0)
    }
}

#[derive(Clone)]
pub struct AppState {
    pub db: Db,
    pub cfg: Config,
    pub events: EventTx,
    pub connections: std::sync::Arc<ConnectionRegistry>,
    pub node_id: String,
    /// 进程级 epoch：每次启动变化，客户端据此判断是否需要重新拉快照
    pub epoch: String,
}
