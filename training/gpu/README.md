# GPU 训练（mmBERT pairwise / ONNX）

当前开发机与远端 `13.158.45.159` 都没有 GPU。本目录用于在一台 CUDA 机器上跑现有流程。

## 机器要求

- NVIDIA GPU，**至少 12GB 显存**（A10 / T4 / 4090 均可；A10 更稳）
- 磁盘 ≥ 20GB（mmBERT 权重 + 输出）
- Python 3.11/3.12
- 能访问 `hf-mirror.com`（脚本默认设置 `HF_ENDPOINT`）

## 数据

把本地以下文件（或整个 `training/data/` + `training/*.py`）同步到 GPU 机器：

```text
training/train_pairwise.py
training/serialize.py
training/gpu/setup.sh
training/data/llm_role/llm_role_train.jsonl   # 大模型生成
training/data/llm_role/llm_role_val.jsonl     # 大模型生成
training/data/llm_role/llm_role_test.jsonl    # 大模型生成（留出）
```

需要扩容时先本地生成（可断点续跑）：

```bash
python training/generate_llm_role_data.py \
  --train-groups 300 --val-groups 80 --test-groups 120 --batch 3
```

## 训练

```bash
bash training/gpu/setup.sh
source training/.venv/bin/activate
export HF_ENDPOINT=https://hf-mirror.com
python training/train_pairwise.py \
  --train training/data/llm_role/llm_role_train.jsonl \
  --test training/data/llm_role/llm_role_test.jsonl \
  --output training/out/mmbert-pairwise-gpu \
  --epochs 8 --groups-batch 8 --max-length 768
```

脚本会自动选择 CUDA；400 组在 A10 上预计几分钟到十几分钟。

## 校准

```bash
# 先启动导出后的 classifier（见 classifier/README.md），再用真实 /rank 校准
python training/calibrate_rank_service.py
```

输出 `CLASSIFIER_RANK_MIN_MARGIN` 推荐值。

## 导出 ONNX

```bash
python training/export_onnx.py \
  --model training/out/mmbert-pairwise-gpu \
  --output classifier/model \
  --quantize --max-length 768
```

把 `classifier/model/{model.onnx,tokenizer.json,labels.json}` 拷回本机或远端：

```bash
cd classifier && cargo run --release --bin chappie-classifier
```

然后在 AI `.env`：

```bash
CLASSIFIER_BASE_URL=http://127.0.0.1:7010
CLASSIFIER_RANK_MIN_MARGIN=<校准值>
```

重启 AI 后生效。当前本机 classifier 关闭，规则运行；GPU 训练完成前不要开启。
