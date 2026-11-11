#!/usr/bin/env bash
# 从品牌源 SVG 一键重新生成所有图标与 favicon。
#
# 源文件：
#   apps/desktop/icon-source.svg   （唯一品牌源）
# 产物：
#   apps/desktop/src-tauri/icons/* （Tauri 桌面图标）
#   apps/desktop/src-tauri/icon.png（1024 渲染图，tauri icon 输入）
#   apps/mobile/assets/icon.png    （Expo 应用图标）
#   apps/web/public/logo.svg       （favicon，与源文件同步）
#
# 用法：pnpm icons
# 依赖：Google Chrome（可通过 CHROME_BIN 覆盖路径）
# 注意：Web / Mobile 的 Logo 组件为内联 SVG，若源图形有改动需同步更新组件。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/apps/desktop/icon-source.svg"
CHROME="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP_HTML="$(mktemp /tmp/chappie-icon-XXXXXX.html)"
TMP_PNG="$(mktemp /tmp/chappie-icon-XXXXXX.png)"
trap 'rm -f "$TMP_HTML" "$TMP_PNG"' EXIT

if [[ ! -f "$SRC" ]]; then
  echo "✗ 缺少品牌源文件: $SRC" >&2
  exit 1
fi
if [[ ! -x "$CHROME" ]]; then
  echo "✗ 未找到 Chrome: $CHROME" >&2
  echo "  可通过环境变量指定，例如：" >&2
  echo "  CHROME_BIN=/path/to/chrome pnpm icons" >&2
  exit 1
fi

# 白底 1024 画布 + 居中 700px 的 SVG（宽度由外层容器控制）
{
  echo '<!doctype html><html><body style="margin:0;width:1024px;height:1024px;display:flex;align-items:center;justify-content:center;background:#ffffff">'
  echo '<div style="width:700px">'
  sed 's/width="100%"/width="100%" style="display:block;width:100%;height:auto"/' "$SRC"
  echo '</div></body></html>'
} > "$TMP_HTML"

echo "→ 渲染 1024×1024 PNG …"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --screenshot="$TMP_PNG" --window-size=1024,1024 "file://$TMP_HTML" >/dev/null 2>&1

echo "→ 生成 Tauri 图标 …"
cp "$TMP_PNG" "$ROOT/apps/desktop/src-tauri/icon.png"
(cd "$ROOT/apps/desktop" && pnpm exec tauri icon src-tauri/icon.png >/dev/null)

echo "→ 生成 Expo 图标 …"
mkdir -p "$ROOT/apps/mobile/assets"
cp "$TMP_PNG" "$ROOT/apps/mobile/assets/icon.png"

echo "→ 同步 favicon …"
cp "$SRC" "$ROOT/apps/web/public/logo.svg"

echo "✅ 图标生成完成：Tauri / Expo / favicon"
echo "ℹ️  若 SVG 图形有改动，请同步更新 Web（apps/web/src/components/ui/logo.tsx）"
echo "    与 Mobile（apps/mobile/src/components/logo.tsx）的内联 SVG。"
