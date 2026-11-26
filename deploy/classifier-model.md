# Classifier model artifact

The deploy workflow needs the int8 model bundle as a downloadable tar.gz.

## 1. Build the archive

From a checkout that has `classifier/model/` (main working tree or `model` branch):

```bash
tar -C classifier/model -czf classifier-model.tar.gz \
  model.onnx tokenizer.json labels.json margin.json \
  tokenizer_config.json special_tokens_map.json
sha256sum classifier-model.tar.gz
```

The archive must contain `model.onnx` at its root.

## 2. Host it

Upload `classifier-model.tar.gz` to object storage / a release asset that CI can read,
for example S3/R2:

```bash
aws s3 cp classifier-model.tar.gz s3://<bucket>/chappie/classifier-model.tar.gz
```

Set the repository secret **`MODEL_ARTIFACTS_URL`** to a durable download URL.
If using a presigned URL, give it a long enough expiry (or use a CI-only token URL).

## 3. Server `.env`

The classifier service itself needs no `.env`; the AI service must point at it:

```bash
AI_ROLE_MODEL=mmbert
AI_ROLE_MATCH=true
CLASSIFIER_BASE_URL=http://127.0.0.1:7010
CLASSIFIER_TIMEOUT_MS=6000
CLASSIFIER_RANK_MIN_MARGIN=-5.691539
```

Then `sudo systemctl restart chappie-ai`.

## Memory

The int8 ONNX model is ~296MB and tokenizer ~33MB. The current smallest remote
(1 vCPU / ~957MB RAM) may not have enough headroom for core + AI + classifier.
Check `free -m` after deploy; if the classifier is OOM-killed, use
`AI_ROLE_MODEL=linear` on that host or resize it.
