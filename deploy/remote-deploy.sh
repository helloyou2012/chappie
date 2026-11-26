#!/usr/bin/env bash
# 服务器端部署脚本 —— 由 GitHub Actions 上传产物后执行；服务器上不做任何构建。
#
# 产物布局（/tmp/chappie-deploy）：
#   bin/im-core          Rust 网关（CI 在 ubuntu-24.04 上 release 构建）
#   web/                 Web 静态产物（CI vite 构建）
#   ai/dist/index.js     ai-platform Bun bundle（CI 打包，自包含，无需 node_modules）
#   ai/dist/migrate.js   AI 数据库迁移 bundle
#   ai/migrations/*.sql  迁移 SQL
#   bin/chappie-classifier       mmBERT ONNX 服务
#   classifier/model/*           int8 ONNX + tokenizer + labels + margin
#   chappie-classifier.service   systemd unit
set -euo pipefail

ROOT=/opt/chappie
SRC=/tmp/chappie-deploy
BUN=/home/ubuntu/.bun/bin/bun

echo "==> deploy start $(date -u +%FT%TZ)"
test -x "$SRC/bin/im-core" || { echo "缺少 bin/im-core"; exit 1; }
test -f "$SRC/ai/dist/index.js" || { echo "缺少 ai/dist/index.js"; exit 1; }
test -x "$SRC/bin/chappie-classifier" || { echo "缺少 bin/chappie-classifier"; exit 1; }
test -f "$SRC/classifier/model/model.onnx" || { echo "缺少 classifier/model/model.onnx"; exit 1; }
test -f "$SRC/classifier/model/tokenizer.json" || { echo "缺少 classifier/model/tokenizer.json"; exit 1; }

sudo mkdir -p "$ROOT/bin" "$ROOT/web" "$ROOT/ai/dist" "$ROOT/ai/migrations" "$ROOT/classifier/model"
sudo install -m 755 "$SRC/bin/im-core" "$ROOT/bin/im-core"
sudo install -m 755 "$SRC/bin/chappie-classifier" "$ROOT/bin/chappie-classifier"
sudo rsync -a --delete "$SRC/web/" "$ROOT/web/"
sudo rsync -a --delete "$SRC/ai/dist/" "$ROOT/ai/dist/"
sudo rsync -a --delete "$SRC/ai/migrations/" "$ROOT/ai/migrations/"
sudo chown -R ubuntu:ubuntu "$ROOT/bin" "$ROOT/web" "$ROOT/ai"

# 数据库迁移（幂等；新增迁移随产物发布，先迁移后重启）
"$BUN" --env-file="$ROOT/.env" "$ROOT/ai/dist/migrate.js"

MEM_MB=$(free -m | awk '/^Mem:/{print $2}')
CLASSIFIER_ENABLED=0
if [ "${MEM_MB:-0}" -ge 1800 ]; then
  CLASSIFIER_ENABLED=1
  sudo rsync -a --delete "$SRC/classifier/model/" "$ROOT/classifier/model/"
  sudo install -m 644 "$SRC/chappie-classifier.service" /etc/systemd/system/chappie-classifier.service
  sudo chown -R ubuntu:ubuntu "$ROOT/classifier"
  sudo systemctl daemon-reload
  sudo systemctl enable --now chappie-classifier
  sudo systemctl restart chappie-classifier
  for _ in $(seq 1 20); do
    if curl -fsS --max-time 2 http://127.0.0.1:7010/health >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if ! curl -fsS --max-time 5 http://127.0.0.1:7010/health; then
    echo "classifier health check failed; recent logs:"
    sudo journalctl -u chappie-classifier -n 40 --no-pager || true
    exit 1
  fi
else
  echo "WARN: 服务器内存 ${MEM_MB:-?}MB < 1800MB，跳过 classifier；请在 .env 使用 AI_ROLE_MODEL=linear"
  sudo systemctl disable --now chappie-classifier 2>/dev/null || true
fi

sudo systemctl restart chappie-core chappie-ai
for _ in $(seq 1 20); do
  if systemctl is-active --quiet chappie-core && systemctl is-active --quiet chappie-ai; then
    break
  fi
  sleep 1
done
systemctl is-active chappie-core chappie-ai
if [ "$CLASSIFIER_ENABLED" = 1 ]; then systemctl is-active chappie-classifier; fi

if ! grep -q '^AI_ROLE_MODEL=mmbert' "$ROOT/.env" 2>/dev/null; then
  echo "WARN: $ROOT/.env 未设置 AI_ROLE_MODEL=mmbert，classifier 已启动但 AI 不会使用"
fi
if ! grep -q '^CLASSIFIER_BASE_URL=http://127.0.0.1:7010' "$ROOT/.env" 2>/dev/null; then
  echo "WARN: $ROOT/.env 未设置 CLASSIFIER_BASE_URL=http://127.0.0.1:7010"
fi

echo "==> deploy done $(date -u +%FT%TZ)"
