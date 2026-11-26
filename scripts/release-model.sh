#!/usr/bin/env bash
# Package deployable model artifacts and publish a GitHub Release.
#
# Usage:
#   scripts/release-model.sh [--tag model-YYYY-MM-DD] [--repo owner/repo] [--dry-run]
#
# Token: GITHUB_TOKEN / GH_TOKEN, or `gh auth token`, or local git credential helper.
# Only artifacts are included: no training data and no training weights.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

TAG=""
REPO=""
DRY_RUN=0
NAME=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG=${2:?}; shift 2 ;;
    --repo) REPO=${2:?}; shift 2 ;;
    --name) NAME=${2:?}; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

TAG=${TAG:-model-$(date -u +%Y-%m-%d)}
REPO=${REPO:-$(git remote get-url origin | sed -E 's#^git@github.com:##; s#^https://github.com/##; s#\.git$##')}
[ -n "$REPO" ] || { echo "cannot determine repo; pass --repo owner/repo" >&2; exit 1; }
NAME=${NAME:-Chappie role-reply models ($TAG)}

required=(
  classifier/model/model.onnx
  classifier/model/tokenizer.json
  classifier/model/labels.json
  classifier/model/margin.json
  classifier/model/tokenizer_config.json
  classifier/model/special_tokens_map.json
  ai/src/models/linear-pairwise.json
  MODEL_CARD.md
)
for f in "${required[@]}"; do
  [ -f "$f" ] || { echo "missing required artifact: $f" >&2; exit 1; }
done

OUT_DIR=${OUT_DIR:-dist/releases}
mkdir -p "$OUT_DIR"
ASSET_NAME="chappie-mmbert-pairwise-$TAG.tar.gz"
ASSET="$OUT_DIR/$ASSET_NAME"
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/chappie-model-release.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/classifier/model" "$STAGE/ai/src/models" "$STAGE/training/out"
cp classifier/model/model.onnx classifier/model/tokenizer.json classifier/model/labels.json \
  classifier/model/margin.json classifier/model/tokenizer_config.json classifier/model/special_tokens_map.json \
  "$STAGE/classifier/model/"
cp ai/src/models/linear-pairwise.json "$STAGE/ai/src/models/"
cp MODEL_CARD.md "$STAGE/MODEL_CARD.md"
for f in training/out/linear-pairwise-llm.json training/out/linear-pairwise-llm.metrics.json; do
  [ -f "$f" ] && cp "$f" "$STAGE/training/out/"
done

tar -czf "$ASSET" -C "$STAGE" .
if command -v sha256sum >/dev/null 2>&1; then
  SHA=$(sha256sum "$ASSET" | awk '{print $1}')
else
  SHA=$(shasum -a 256 "$ASSET" | awk '{print $1}')
fi
printf '%s  %s\n' "$SHA" "$ASSET_NAME" > "$ASSET.sha256"

NOTES="$STAGE/RELEASE_NOTES.md"
cp MODEL_CARD.md "$NOTES"
printf '\n---\n\nSHA256: `%s`\nAsset: `%s` (%s bytes)\n' "$SHA" "$ASSET_NAME" "$(wc -c < "$ASSET" | tr -d ' ')" >> "$NOTES"

echo "tag:    $TAG"
echo "repo:   $REPO"
echo "asset:  $ASSET ($(wc -c < "$ASSET" | tr -d ' ') bytes)"
echo "sha256: $SHA"
if [ "$DRY_RUN" = 1 ]; then
  echo "dry-run: release not created"
  exit 0
fi

TOKEN=${GITHUB_TOKEN:-${GH_TOKEN:-}}
if [ -z "$TOKEN" ] && command -v gh >/dev/null 2>&1; then
  TOKEN=$(gh auth token 2>/dev/null || true)
fi
if [ -z "$TOKEN" ]; then
  TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p' || true)
fi
[ -n "$TOKEN" ] || { echo "no GitHub token: set GITHUB_TOKEN/GH_TOKEN or run gh auth login" >&2; exit 1; }

# Fail clearly if the release tag already exists.
HTTP=$(curl -s -o /tmp/release-existing.json -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$REPO/releases/tags/$TAG")
if [ "$HTTP" = "200" ]; then
  echo "release tag already exists: $TAG (choose another --tag)" >&2
  exit 1
fi

python3 - "$TAG" "$NAME" "$NOTES" "$REPO" <<'PY'
import json, sys
tag, name, notes_path, repo = sys.argv[1:5]
body = open(notes_path, encoding='utf-8').read()
payload = {
    'tag_name': tag,
    'target_commitish': 'main',
    'name': name,
    'body': body,
    'draft': False,
    'prerelease': False,
}
json.dump(payload, open('/tmp/release-payload.json', 'w'), ensure_ascii=False)
PY

HTTP=$(curl -s -o /tmp/release-created.json -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $TOKEN" -H 'Accept: application/vnd.github+json' \
  -H 'Content-Type: application/json' --data-binary @/tmp/release-payload.json \
  "https://api.github.com/repos/$REPO/releases")
if [ "$HTTP" != "201" ]; then
  echo "create release failed (HTTP $HTTP)" >&2
  python3 -c 'import json; print(json.load(open("/tmp/release-created.json")).get("message",""))' >&2 || true
  exit 1
fi
RELEASE_ID=$(python3 -c 'import json; print(json.load(open("/tmp/release-created.json"))["id"])')
RELEASE_URL=$(python3 -c 'import json; print(json.load(open("/tmp/release-created.json"))["html_url"])')

HTTP=$(curl -s -o /tmp/release-asset.json -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/gzip' \
  --data-binary "@$ASSET" \
  "https://uploads.github.com/repos/$REPO/releases/$RELEASE_ID/assets?name=$ASSET_NAME")
if [ "$HTTP" != "201" ]; then
  echo "upload asset failed (HTTP $HTTP); release: $RELEASE_URL" >&2
  python3 -c 'import json; print(json.load(open("/tmp/release-asset.json")).get("message",""))' >&2 || true
  exit 1
fi

ASSET_URL=$(python3 -c 'import json; print(json.load(open("/tmp/release-asset.json"))["browser_download_url"])')
echo "release: $RELEASE_URL"
echo "asset:   $ASSET_URL"
