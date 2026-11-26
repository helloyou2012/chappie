#!/usr/bin/env python3
"""用训练好的 pairwise mmBERT 评估 test/val，并加上运行时“无回应线索静默”门控。"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from train_linear_pairwise import has_reply_cue
from train_pairwise import encode, group_metrics, load_groups


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="training/out/mmbert-pairwise-llm")
    ap.add_argument("--data", default="training/data/llm_role/llm_role_test.jsonl")
    ap.add_argument("--max-length", type=int, default=576)
    ap.add_argument("--margin", type=float, default=None)
    args = ap.parse_args()

    margin = args.margin
    if margin is None:
        margin = json.loads(
            (Path(args.model) / "margin.json").read_text(encoding="utf-8")
        )["margin"]
    groups = load_groups(args.data)
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
    records = []
    with torch.no_grad():
        for rows, labels in groups:
            x = encode(tok, [r["text"] for r in rows], args.max_length)
            x = {k: v.to(device) for k, v in x.items()}
            scores = model(**x).logits[:, 1].detach().cpu().numpy()
            real = scores[:-1]
            silence = float(scores[-1])
            top = int(np.argmax(real))
            any_reply = any(labels[:-1])
            records.append(
                {
                    "conv_id": rows[0].get("conv_id", ""),
                    "any_reply": any_reply,
                    "margin": float(np.max(real) - silence),
                    "top_is_reply": int(labels[top] == 1) if any_reply else None,
                    "cue": has_reply_cue(rows[0]["trigger"].get("text", "")),
                }
            )
    gated = []
    for r in records:
        if not r["cue"]:
            r = dict(r, margin=float("-inf"))
        gated.append(r)
    print("rows", len(records), "margin", margin)
    print("raw", json.dumps(group_metrics(records, margin), ensure_ascii=False))
    print("gated", json.dumps(group_metrics(gated, margin), ensure_ascii=False))


if __name__ == "__main__":
    main()
