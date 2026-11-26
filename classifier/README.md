# chappie-classifier

本地 reply/silent 接话决策服务：mmBERT ONNX + ONNX Runtime。输入是某个分身视角的
私聊/群聊上下文（谁、何时、说了什么、@了谁），输出该分身是否应该回复。

## 模型文件

```text
classifier/model/
  model.onnx        # 量化后的 mmBERT 分类模型
  tokenizer.json
  labels.json       # 与 training/labels.json 一致
```

模型较大，不提交仓库。训练/导出见 `training/README.md`。

## 运行

```bash
cd classifier
cargo run --release
```

默认监听 `127.0.0.1:7010`，可覆盖：

```bash
CLASSIFIER_MODEL_PATH=model/model.onnx \
CLASSIFIER_TOKENIZER_PATH=model/tokenizer.json \
CLASSIFIER_LABELS_PATH=model/labels.json \
CLASSIFIER_PORT=7010 \
CLASSIFIER_MAX_LEN=576 \
cargo run --release
```

接口：

- `POST /classify`：单候选 reply/silent
- `POST /rank`：同一消息下的多个候选批量打分（pairwise/角色匹配）

  ```json
  { "texts": ["候选A上下文", "候选B上下文"] }
  → { "scores": [...], "probs": [...] }
  ```

```bash
curl -s localhost:7010/classify \
  -H 'content-type: application/json' \
  -d '{"text":"[群聊]\n观察者：..."}'
```

## 接入 Bun

```bash
AI_ROLE_MODEL=mmbert
AI_ROLE_MATCH=true
CLASSIFIER_BASE_URL=http://127.0.0.1:7010
CLASSIFIER_TIMEOUT_MS=6000
CLASSIFIER_RANK_MIN_MARGIN=-5.691539  # 以 classifier/model/margin.json 为准
```

`CLASSIFIER_MAX_LEN` 必须与导出/训练的 `--max-length` 一致（当前 576）。
margin 必须用 `training/calibrate_rank_service.py` 经真实 `/rank` 重新校准（见 `model/margin.json`）。
未配置或服务不可用时，Bun 自动回退到规则分类器。
