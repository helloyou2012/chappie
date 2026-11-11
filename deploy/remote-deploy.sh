#!/usr/bin/env bash
# 服务器端部署脚本 —— 由 GitHub Actions 上传产物后执行；服务器上不做任何构建。
#
# 产物布局（/tmp/chappie-deploy）：
#   bin/im-core          Rust 网关（CI 在 ubuntu-24.04 上 release 构建）
#   web/                 Web 静态产物（CI vite 构建）
#   ai/dist/index.js     ai-platform Bun bundle（CI 打包，自包含，无需 node_modules）
#   ai/dist/migrate.js   AI 数据库迁移 bundle
#   ai/migrations/*.sql  迁移 SQL
set -euo pipefail

ROOT=/opt/chappie
SRC=/tmp/chappie-deploy
BUN=/home/ubuntu/.bun/bin/bun

echo "==> deploy start $(date -u +%FT%TZ)"
test -x "$SRC/bin/im-core" || { echo "缺少 bin/im-core"; exit 1; }
test -f "$SRC/ai/dist/index.js" || { echo "缺少 ai/dist/index.js"; exit 1; }

sudo mkdir -p "$ROOT/bin" "$ROOT/web" "$ROOT/ai/dist" "$ROOT/ai/migrations"
sudo install -m 755 "$SRC/bin/im-core" "$ROOT/bin/im-core"
sudo rsync -a --delete "$SRC/web/" "$ROOT/web/"
sudo rsync -a --delete "$SRC/ai/dist/" "$ROOT/ai/dist/"
sudo rsync -a --delete "$SRC/ai/migrations/" "$ROOT/ai/migrations/"
sudo chown -R ubuntu:ubuntu "$ROOT/bin" "$ROOT/web" "$ROOT/ai"

# 数据库迁移（幂等；新增迁移随产物发布，先迁移后重启）
"$BUN" --env-file="$ROOT/.env" "$ROOT/ai/dist/migrate.js"

sudo systemctl restart chappie-core chappie-ai

for _ in $(seq 1 15); do
  if systemctl is-active --quiet chappie-core && systemctl is-active --quiet chappie-ai; then
    break
  fi
  sleep 1
done
systemctl is-active chappie-core chappie-ai

echo "==> deploy done $(date -u +%FT%TZ)"
