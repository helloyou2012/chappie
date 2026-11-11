//! im-core 入口：装配存储、事件通道、fanout、对外网关与内部 API。
//!
//! 对外（0.0.0.0:GATEWAY_PORT）：REST /api/v1/* + /ws
//! 内部（127.0.0.1:INTERNAL_PORT）：/internal/v1/*（X-Internal-Token 鉴权，Bun 调用）

use im_core_chat::{event_channel, AppState, ConnectionRegistry};
use im_core_gateway::{fanout, rest, ws};
use im_core_store::Db;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let cfg = im_core_common::Config::from_env();
    let db = Db::connect(&cfg).await?;
    db.migrate().await?;

    let (events, _) = event_channel();
    let state = AppState {
        db,
        cfg: cfg.clone(),
        events,
        connections: std::sync::Arc::new(ConnectionRegistry::default()),
        node_id: uuid::Uuid::new_v4().to_string(),
    };

    tokio::spawn(fanout::run_local_fanout(state.clone()));
    let bus_state = state.clone();
    tokio::spawn(async move {
        if let Err(e) = fanout::run_redis_bus(bus_state).await {
            tracing::warn!(error = ?e, "redis bus 停止（多节点广播不可用，单节点仍正常）");
        }
    });

    // 对外网关
    let app = axum::Router::new()
        .merge(rest::public_routes())
        .merge(rest::protected_routes(state.clone()))
        .route("/ws", axum::routing::get(ws::ws_handler))
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(state.clone());
    let gateway_addr = format!("0.0.0.0:{}", cfg.gateway_port);
    let gateway_listener = tokio::net::TcpListener::bind(&gateway_addr).await?;

    // 内部 API（仅回环）
    let internal = im_core_internal_api::router(state.clone()).with_state(state.clone());
    let internal_addr = format!("127.0.0.1:{}", cfg.internal_port);
    let internal_listener = tokio::net::TcpListener::bind(&internal_addr).await?;

    tracing::info!("🚀 im-core 已启动: gateway http://{gateway_addr} | internal http://{internal_addr}");

    let gw = axum::serve(gateway_listener, app).with_graceful_shutdown(shutdown_signal());
    let int = axum::serve(internal_listener, internal);
    tokio::try_join!(gw, int)?;
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        let _ = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutdown signal received, draining connections…");
}
