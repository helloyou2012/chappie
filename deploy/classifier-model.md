# Classifier model artifact（可选）

Classifier 是可选组件。未设置 `MODEL_ARTIFACTS_URL`，或服务器 RAM < 1800MB 时，
部署会自动跳过 classifier，AI 使用 bundle 内置的 linear 模型
（`ai/dist/models/linear-pairwise.json`，`AI_ROLE_MODEL=linear`）。

需要 mmBERT `/rank` 时，再准备下面的 int8 model bundle。

## 1. 需要 mmBERT 时：Build the archive

From a checkout that has `classifier/model/` (main working tree or `model` branch):

```bash
tar -C classifier/model -czf classifier-model.tar.gz \
  model.onnx tokenizer.json labels.json margin.json \
  tokenizer_config.json special_tokens_map.json
sha256sum classifier-model.tar.gz
```

The archive must contain `model.onnx` at its root.

## 2. 需要 mmBERT 时：Host it

Upload `classifier-model.tar.gz` to object storage / a release asset that CI can read,
for example S3/R2:

```bash
aws s3 cp classifier-model.tar.gz s3://<bucket>/chappie/classifier-model.tar.gz
```

Set the repository secret **`MODEL_ARTIFACTS_URL`** to a durable download URL.
If using a presigned URL, give it a long enough expiry (or use a CI-only token URL).

## 3. Server `.env`（mmBERT 模式）

The classifier service itself needs no `.env`; the AI service must point at it
（小内存服务器改为 `AI_ROLE_MODEL=linear`，不要设 `CLASSIFIER_BASE_URL`）：

```bash
AI_ROLE_MODEL=mmbert
AI_ROLE_MATCH=true
CLASSIFIER_BASE_URL=http://127.0.0.1:7010
CLASSIFIER_TIMEOUT_MS=6000
CLASSIFIER_RANK_MIN_MARGIN=-5.691539
```

Then `sudo systemctl restart chappie-ai`.

## Memory

The int8 ONNX model is ~296MB and tokenizer ~33MB. `remote-deploy.sh` checks RAM: below **1800MB** it skips the classifier and keeps
`AI_ROLE_MODEL=linear`/rule fallback. The current smallest remote
(1 vCPU / ~957MB RAM) is below this threshold. Resize to >=2GB, then redeploy
to enable `/rank`.
