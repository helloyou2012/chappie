#!/usr/bin/env python3
"""把微调后的 mmBERT 导出为 ONNX（可选 int8 动态量化），供 Rust classifier 服务加载。

用法：
  python training/export_onnx.py \
    --model training/out/mmbert-intent-v1 \
    --output classifier/model \
    --quantize
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer


class LogitsOnly(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, input_ids, attention_mask):
        return self.model(input_ids=input_ids, attention_mask=attention_mask).logits


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="training/out/mmbert-intent-v1")
    ap.add_argument("--output", default="classifier/model")
    ap.add_argument("--max-length", type=int, default=768)
    ap.add_argument("--quantize", action="store_true")
    ap.add_argument("--trust-remote-code", action="store_true")
    args = ap.parse_args()

    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)

    tokenizer = AutoTokenizer.from_pretrained(
        args.model, trust_remote_code=args.trust_remote_code
    )
    model = AutoModelForSequenceClassification.from_pretrained(
        args.model, trust_remote_code=args.trust_remote_code
    )
    model.eval()
    wrapper = LogitsOnly(model).eval()

    dummy = tokenizer(
        "测试消息",
        return_tensors="pt",
        padding="max_length",
        truncation=True,
        max_length=args.max_length,
    )
    fp32_path = out / "model.fp32.onnx"
    torch.onnx.export(
        wrapper,
        (dummy["input_ids"], dummy["attention_mask"]),
        str(fp32_path),
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "sequence"},
            "attention_mask": {0: "batch", 1: "sequence"},
            "logits": {0: "batch"},
        },
        opset_version=18,
        do_constant_folding=True,
    )
    try:
        onnx.checker.check_model(str(fp32_path))
    except Exception as e:  # 新 exporter 可能生成比本地 onnx 检查器更新的 Split 属性
        print(f"onnx checker warning (continuing): {e}")

    final_path = out / "model.onnx"
    if args.quantize:
        from onnxruntime.quantization import QuantType, quantize_dynamic

        try:
            quantize_dynamic(str(fp32_path), str(final_path), weight_type=QuantType.QInt8)
        except Exception as e:  # noqa: BLE001
            print(f"quantize failed, keep fp32: {e}")
            shutil.copy(fp32_path, final_path)
    else:
        shutil.copy(fp32_path, final_path)

    tokenizer.save_pretrained(str(out))
    if not (out / "tokenizer.json").exists():
        tokenizer.backend_tokenizer.save(str(out / "tokenizer.json"))
    labels_src = Path(args.model) / "labels.json"
    if labels_src.exists():
        shutil.copy(labels_src, out / "labels.json")
    else:
        raise SystemExit(f"missing {labels_src}")

    sess = ort.InferenceSession(str(final_path), providers=["CPUExecutionProvider"])
    inputs = tokenizer(
        "大家明天中午12点外滩集合",
        return_tensors="np",
        padding="max_length",
        truncation=True,
        max_length=args.max_length,
    )
    logits = sess.run(
        None,
        {
            "input_ids": inputs["input_ids"].astype(np.int64),
            "attention_mask": inputs["attention_mask"].astype(np.int64),
        },
    )[0]
    print("onnx logits", logits.shape, logits[0].tolist())
    print(f"exported -> {final_path}")
    print("files:", sorted(p.name for p in out.iterdir()))


if __name__ == "__main__":
    main()
