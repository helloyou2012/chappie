//! gateway：对外 HTTP/WS（REST + 实时帧）与 fanout（在线推送、跨节点广播）。
//! 对应设计方案 §25.3 连接网关、§25.4 扇出。

pub mod fanout;
pub mod rest;
pub mod ws;
