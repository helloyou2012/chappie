//! 本地 reply/silent 接话决策服务：加载 mmBERT ONNX，由 Bun AI 平台对 auto/direct 候选调用。
//!
//! 环境变量：
//!   CLASSIFIER_MODEL_PATH      model/model.onnx
//!   CLASSIFIER_TOKENIZER_PATH  model/tokenizer.json
//!   CLASSIFIER_LABELS_PATH     model/labels.json
//!   CLASSIFIER_PORT            7010
//!   CLASSIFIER_MAX_LEN         768（与训练一致）

use std::collections::HashMap;
use std::env;
use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use ndarray::Array2;
use ort::environment::Environment;
use ort::session::Session;
use ort::value::Value;
use serde::{Deserialize, Serialize};
use tokenizers::{Tokenizer, TruncationParams};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tracing::{error, info};
use tracing_subscriber::EnvFilter;

#[derive(Debug, Clone, Deserialize)]
struct Label {
    label: String,
    intent: String,
    #[serde(rename = "needReply")]
    need_reply: bool,
}

#[derive(Debug, Deserialize)]
struct ClassifyRequest {
    text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClassifyResponse {
    label: String,
    intent: String,
    need_reply: bool,
    confidence: f32,
    scores: HashMap<String, f32>,
}

#[derive(Debug, Deserialize)]
struct RankRequest {
    texts: Vec<String>,
}

#[derive(Debug, Serialize)]
struct RankResponse {
    /// reply 类的原始 logit（用于候选间排序）
    scores: Vec<f32>,
    /// reply 类概率
    probs: Vec<f32>,
}

#[derive(Clone)]
struct AppState {
    session: Arc<Mutex<Session>>,
    tokenizer: Arc<Tokenizer>,
    labels: Arc<Vec<Label>>,
    max_len: usize,
    _environment: Environment,
}

fn env_or(name: &str, default: &str) -> String {
    env::var(name).unwrap_or_else(|_| default.to_string())
}

fn softmax(logits: &[f32]) -> Vec<f32> {
    let max = logits.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let exps: Vec<f32> = logits.iter().map(|v| (v - max).exp()).collect();
    let sum: f32 = exps.iter().sum();
    exps.into_iter()
        .map(|v| v / sum.max(f32::EPSILON))
        .collect()
}

async fn run_batch(
    state: &AppState,
    texts: &[String],
) -> Result<Vec<Vec<f32>>, (StatusCode, String)> {
    if texts.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "texts is required".into()));
    }
    let mut encoded: Vec<(Vec<i64>, Vec<i64>)> = Vec::with_capacity(texts.len());
    let mut max_len = 1usize;
    for text in texts {
        let text = text.trim();
        if text.is_empty() {
            return Err((StatusCode::BAD_REQUEST, "empty text".into()));
        }
        let encoding = state
            .tokenizer
            .encode(text, true)
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("tokenize failed: {e}")))?;
        let mut ids: Vec<i64> = encoding.get_ids().iter().map(|v| *v as i64).collect();
        let mut mask: Vec<i64> = encoding
            .get_attention_mask()
            .iter()
            .map(|v| *v as i64)
            .collect();
        let mut len = ids.len().min(state.max_len);
        while len > 0 && mask[len - 1] == 0 {
            len -= 1;
        }
        if len == 0 {
            return Err((StatusCode::BAD_REQUEST, "empty tokens".into()));
        }
        ids.truncate(len);
        mask.truncate(len);
        max_len = max_len.max(len);
        encoded.push((ids, mask));
    }

    let n = encoded.len();
    let mut ids_flat = vec![0i64; n * max_len];
    let mut mask_flat = vec![0i64; n * max_len];
    for (i, (ids, mask)) in encoded.iter().enumerate() {
        ids_flat[i * max_len..i * max_len + ids.len()].copy_from_slice(ids);
        mask_flat[i * max_len..i * max_len + mask.len()].copy_from_slice(mask);
    }
    let ids = Array2::from_shape_vec((n, max_len), ids_flat)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("shape: {e}")))?;
    let mask = Array2::from_shape_vec((n, max_len), mask_flat)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("shape: {e}")))?;

    let mut session = state.session.lock().await;
    let outputs = session
        .run(ort::inputs![
            "input_ids" => Value::from_array(ids)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("tensor: {e}")))?,
            "attention_mask" => Value::from_array(mask)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("tensor: {e}")))?,
        ])
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("onnx: {e}")))?;
    let (_, data) = outputs["logits"]
        .try_extract_tensor::<f32>()
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("logits: {e}")))?;
    let classes = state.labels.len();
    if data.len() < n * classes {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("logits size {} < {}", data.len(), n * classes),
        ));
    }
    Ok((0..n)
        .map(|i| data[i * classes..(i + 1) * classes].to_vec())
        .collect())
}

async fn classify(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ClassifyRequest>,
) -> Result<Json<ClassifyResponse>, (StatusCode, String)> {
    let rows = run_batch(&state, &[req.text]).await?;
    let scores_vec = softmax(&rows[0]);
    let (best_idx, &best) = scores_vec
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
        .ok_or_else(|| (StatusCode::INTERNAL_SERVER_ERROR, "empty scores".into()))?;
    let label = state.labels[best_idx].clone();
    let mut scores = HashMap::new();
    for (i, l) in state.labels.iter().enumerate() {
        scores.insert(l.label.clone(), scores_vec[i]);
    }
    Ok(Json(ClassifyResponse {
        label: label.label,
        intent: label.intent,
        need_reply: label.need_reply,
        confidence: best,
        scores,
    }))
}

async fn rank(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RankRequest>,
) -> Result<Json<RankResponse>, (StatusCode, String)> {
    let reply_idx = state
        .labels
        .iter()
        .position(|l| l.label == "reply")
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "missing reply label".into(),
            )
        })?;
    // 单条推理：控制激活内存，适配 1GB 级远端；/rank 的时延由调用方超时兜底。
    let mut scores = Vec::with_capacity(req.texts.len());
    let mut probs = Vec::with_capacity(req.texts.len());
    for text in &req.texts {
        let rows = run_batch(&state, std::slice::from_ref(text)).await?;
        let row = rows
            .first()
            .ok_or_else(|| (StatusCode::INTERNAL_SERVER_ERROR, "empty rank row".into()))?;
        let p = softmax(row);
        scores.push(row[reply_idx]);
        probs.push(p[reply_idx]);
    }
    Ok(Json(RankResponse { scores, probs }))
}

async fn health(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "ok": true,
        "labels": state.labels.iter().map(|l| l.label.clone()).collect::<Vec<_>>(),
        "maxLen": state.max_len,
    }))
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let model_path = env_or("CLASSIFIER_MODEL_PATH", "model/model.onnx");
    let tokenizer_path = env_or("CLASSIFIER_TOKENIZER_PATH", "model/tokenizer.json");
    let labels_path = env_or("CLASSIFIER_LABELS_PATH", "model/labels.json");
    let port: u16 = env_or("CLASSIFIER_PORT", "7010")
        .parse()
        .context("CLASSIFIER_PORT")?;
    let max_len: usize = env_or("CLASSIFIER_MAX_LEN", "768")
        .parse()
        .context("CLASSIFIER_MAX_LEN")?;

    let labels: Vec<Label> = serde_json::from_slice(
        &std::fs::read(&labels_path).with_context(|| format!("read {labels_path}"))?,
    )
    .context("parse labels")?;
    if labels.is_empty() {
        return Err(anyhow!("labels must not be empty"));
    }
    let mut tokenizer =
        Tokenizer::from_file(&tokenizer_path).map_err(|e| anyhow!("load tokenizer: {e}"))?;
    tokenizer
        .with_truncation(Some(TruncationParams {
            max_length: max_len,
            ..Default::default()
        }))
        .map_err(|e| anyhow!("configure truncation: {e}"))?;
    let environment = ort::init()
        .with_name("chappie-classifier")
        .build()
        .context("ort environment")?;
    let mut builder = Session::builder(&environment).context("ort builder")?;
    // 低内存部署：禁用内存 pattern，单线程；大模型在小内存机器上更稳
    builder = builder
        .with_memory_pattern(false)
        .map_err(|e| anyhow!("ort memory pattern: {e}"))?;
    builder = builder
        .with_intra_threads(1)
        .map_err(|e| anyhow!("ort threads: {e}"))?;
    let session = builder
        .commit_from_file(&model_path)
        .with_context(|| format!("load model {model_path}"))?;

    let state = Arc::new(AppState {
        session: Arc::new(Mutex::new(session)),
        tokenizer: Arc::new(tokenizer),
        labels: Arc::new(labels),
        max_len,
        _environment: environment,
    });

    let app = Router::new()
        .route("/health", get(health))
        .route("/classify", post(classify))
        .route("/rank", post(rank))
        .with_state(state);

    let addr: SocketAddr = format!("127.0.0.1:{port}").parse()?;
    let listener = TcpListener::bind(addr).await?;
    info!(%addr, model=%model_path, "classifier listening");
    if let Err(e) = axum::serve(listener, app).await {
        error!("server error: {e}");
        return Err(e.into());
    }
    Ok(())
}
