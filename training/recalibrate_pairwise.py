#!/usr/bin/env python3
"""用已验证的 mmBERT checkpoint 重新校准 margin（不重新训练）。"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

import train_pairwise as tp


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="training/out/mmbert-pairwise-llm")
    ap.add_argument("--val", default="training/data/llm_role/llm_role_val.jsonl")
    ap.add_argument("--test", default="training/data/llm_role/llm_role_test.jsonl")
    ap.add_argument("--max-length", type=int, default=576)
    args = ap.parse_args()

    tok = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForSequenceClassification.from_pretrained(args.model).eval()
    device = torch.device(
        "mps"
        if torch.backends.mps.is_available()
        else "cuda"
        if torch.cuda.is_available()
        else "cpu"
    )
    model.to(device)
    tp.model = model  # evaluate_records 使用模块级 model

    def forward(rows):
        x = tp.encode(tok, [r["text"] for r in rows], args.max_length)
        x = {k: v.to(device) for k, v in x.items()}
        with torch.no_grad():
            return model(**x).logits

    val_groups = tp.load_groups(args.val)
    test_groups = tp.load_groups(args.test)
    val_records = tp.evaluate_records(val_groups, forward)
    margin, val_metrics = tp.calibrate_margin(val_records)
    test_records = tp.evaluate_records(test_groups, forward)
    test_metrics = tp.group_metrics(test_records, margin)
    print("margin", margin)
    print("val", json.dumps(val_metrics, ensure_ascii=False))
    print("test", json.dumps(test_metrics, ensure_ascii=False))

    path = Path(args.model) / "margin.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data.update(
        {
            "margin": round(float(margin), 6),
            "val": val_metrics,
            "test": test_metrics,
            "max_length": args.max_length,
        }
    )
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("updated", path)


if __name__ == "__main__":
    main()
