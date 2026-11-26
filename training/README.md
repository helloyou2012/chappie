# 角色接话模型（LLM 生成数据 + mmBERT/线性 pairwise）

工作群里一个分身是否该接话，核心是“这条消息是否在找我的职责/姓名”。

当前运行时主模型是 **mmBERT-base pairwise**（int8 ONNX，`classifier` `/rank`）；
同时保留 **CPU 毫秒级线性 pairwise** 作为无需外部服务的备选/回退。

- 训练/验证/测试的**角色标注数据由大模型生成**：群成员、角色/部门、上下文、触发消息、
  每个观察者的 `reply/silent` 标签；不使用真实聊天，也不使用 G1001。
  最终训练可叠加本仓库脚本生成的角色模板数据，仅做覆盖补充。
- 回复组与沉默组分开生成，**组级 50/50**；回复组必须明确指向某个责任角色或姓名，
  沉默组是通知/进度/闲聊/已闭环信息。
- 脚本做结构校验：成员/分身配对、发送者、标签覆盖、无 `@`、职责词与标签一致。
- 特征是角色类别 × 触发消息职责词、点名、意图词、上下文长度、回应线索等 110 维，
  模型是 logistic pairwise；阈值在验证集上按组级 balanced accuracy 与候选 F1 联合校准。
- 线性模式 `AI_ROLE_MODEL=linear`；mmBERT 模式 `AI_ROLE_MODEL=mmbert` +
  `CLASSIFIER_BASE_URL`；模型缺失/损坏回退到 `role-match.ts` 规则。

## 1. 生成数据

```bash
python training/generate_llm_role_data.py \
  --train-groups 120 --val-groups 40 --test-groups 60 \
  --batch 3 --out-dir training/data/llm_role
```

输出：

- `training/data/llm_role/llm_role_train.jsonl`
- `training/data/llm_role/llm_role_val.jsonl`
- `training/data/llm_role/llm_role_test.jsonl`

生成过程按 `cache_{split}_{kind}.jsonl` 增量落盘，中断后重跑同一命令会断点续跑。
每个样本已序列化为 `serialize.py` 的观察者视角格式，标签为 `reply/silent`。

## 1b. 训练数据保存

**需要保存**的是最终三份 JSONL 和清单：

```text
training/data/llm_role/llm_role_train.jsonl   2.0MB
training/data/llm_role/llm_role_val.jsonl     0.7MB
training/data/llm_role/llm_role_test.jsonl    1.0MB
training/data/llm_role/MANIFEST.json          # 组数/样本数/文件 sha256
```

原因：test 是独立评估集；大模型生成不可完全复现，保留数据和哈希才能复现指标。

- `training/.gitignore` 已对 `llm_role/llm_role_*.jsonl` 和 `MANIFEST.json` 解除忽略；
  这三份数据和清单已提交到 `main`，可直接用于复现。
- `cache_*.jsonl`（约 3.5MB）是生成过程的断点缓存，最终文件生成后**可以删除**；
  跑 `generate_llm_role_data.py` 时可保留以便续跑。
- `pairwise_templates_1000.jsonl`（14MB）是线性模型的辅助模板数据，可由
  `generate_pairwise_templates.py` 重新生成，不必顺手提交。

模型产物：

- `training/out/mmbert-pairwise-llm/`（约 1.2GB）用于重新导出/继续训练，建议放
  模型制品存储，不进 Git。
- `classifier/model/` 里运行时只需要 `model.onnx`（int8，约 296MB）、`tokenizer.json`、
  `labels.json`、`margin.json`；`model.fp32.onnx*`（约 1.1GB）仅调试/重新量化用，
  确认 int8 可用后可以删除。
- 线性模型的 `ai/src/models/linear-pairwise.json` 只有几 KB，适合进仓库。

## 2. 训练与评估

```bash
# 如模板数据已清理，先重新生成（可选）
python training/generate_pairwise_templates.py --groups 1000

python training/train_linear_pairwise.py \
  --extra-train training/data/pairwise_templates_1000.jsonl \
  --llm-weight 3
```

- `--llm-weight 3`：LLM 生成数据加权 3，模板合成数据只做覆盖补充。
- 不想要模板数据时去掉 `--extra-train`，只训练 LLM 数据。
- 训练产物：`training/out/linear-pairwise-llm.json`、
  `training/out/linear-pairwise-llm.metrics.json`。
- 指标口径：回复组召回、沉默组误唤醒、组级 balanced accuracy、回复组 top1、
  样本级 precision/recall/F1。

当前模型（2026-11-26；train/val/test 由大模型生成，训练叠加模板辅助；未使用真实聊天/G1001）：

| split | 组数 | 回复组召回 | 沉默组误唤醒 | 回复组 top1 | 候选级 P / R / F1     |
| ----- | ---- | ---------- | ------------ | ----------- | --------------------- |
| train | 120  | 98.3%      | 0.0%         | 98.3%       | 80.3% / 96.8% / 87.8% |
| val   | 40   | 90.0%      | 0.0%         | 90.0%       | 78.3% / 90.0% / 83.7% |
| test  | 60   | 93.3%      | 0.0%         | 96.7%       | 83.3% / 90.9% / 87.0% |

- 阈值在 val 上按“组级 balanced accuracy + 候选级 F1”联合选择：`-0.797818`。
- 特征维数 `26 + 21 角色 × 4 = 110`；模型文件已同步到
  `ai/src/models/linear-pairwise.json`。
- 运行时先做“无回应线索则沉默”的门控（纯通知/公告/闲聊），再对 auto/direct
  候选打分；显式 @ 不进入模型。
- 测试集为独立生成的分组，未参与训练/阈值选择。

## 3. 接入运行时

```bash
cp training/out/linear-pairwise-llm.json ai/src/models/linear-pairwise.json
```

`.env`：

```bash
AI_ROLE_MATCH=true
AI_ROLE_MODEL=linear
# AI_ROLE_MODEL_PATH=ai/src/models/linear-pairwise.json
```

Bun 侧只对 **工作群、无具体 @、auto/direct** 的候选打分；
最高分超过阈值才允许该分身回复，否则所有 auto/direct 候选沉默。
显式 @、回复、延续仍由路由/策略处理；模型异常自动回退角色规则。

## 3b. mmBERT-base pairwise（可选，Apple MPS / CUDA）

同一份 LLM 生成数据也可以训练 mmBERT-base。脚本按 val 选 best checkpoint 并校准
`margin = max(真实候选 reply logit) - silence logit`，test 只在最后评估一次。

```bash
HF_HUB_OFFLINE=1 python training/train_pairwise.py \
  --train training/data/llm_role/llm_role_train.jsonl \
  --val training/data/llm_role/llm_role_val.jsonl \
  --test training/data/llm_role/llm_role_test.jsonl \
  --output training/out/mmbert-pairwise-llm \
  --epochs 8 --groups-batch 2 --max-length 576 --lr 4e-5
```

产物：`training/out/mmbert-pairwise-llm/`（模型、tokenizer、`labels.json`、`margin.json`）。
`max-length=576` 覆盖当前数据 p90=447/max=528 token；不要降到 256，否则当前消息会被截断。

**注意**：Python 训练 tokenizer 与导出后 Rust classifier tokenizer 的编码不完全一致，
因此运行时 margin 必须用真实 `/rank` 服务重新校准，而不是直接使用训练目录里的
fp32 `margin.json`。

```bash
python training/calibrate_rank_service.py
# 用真实 /rank 在 val 上校准，写入 classifier/model/margin.json
```

当前 int8 `/rank` 校准结果（margin `-5.691539`）：

| split | 组数 | 回复组召回 | 沉默组误唤醒 | top1 |
| ----- | ---- | ---------- | ------------ | ---- |
| val   | 40   | 100%       | 0%           | 100% |
| test  | 60   | 96.7%      | 0%           | 100% |

对比线性模型 test（93.3% / 0% / 96.7%），mmBERT 召回与 top1 更好。

导出 ONNX 并启动分类服务：

```bash
python training/export_onnx.py \
  --model training/out/mmbert-pairwise-llm \
  --output classifier/model \
  --quantize --max-length 576

cd classifier
CLASSIFIER_MAX_LEN=576 cargo run --release
```

Bun 运行时：

```bash
AI_ROLE_MODEL=mmbert
AI_ROLE_MATCH=true
CLASSIFIER_BASE_URL=http://127.0.0.1:7010
CLASSIFIER_TIMEOUT_MS=12000
CLASSIFIER_RANK_MIN_MARGIN=-5.691539  # 以 classifier/model/margin.json 为准
```

`AI_ROLE_MODEL=mmbert` 平时跳过线性模型和角色关键词规则，直接使用 `/rank` pairwise 结果；
`/rank` 超时/不可用时回退角色规则。纯通知/公告仍先由回应线索门控静默。
