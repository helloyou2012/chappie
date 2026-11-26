#!/usr/bin/env python3
"""通过真实 classifier /rank 服务评估并校准 margin（与运行时完全一致）。"""
from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

import numpy as np

import train_pairwise as tp


def rank(texts: list[str], url: str) -> list[float]:
    req = urllib.request.Request(
        f"{url.rstrip('/')}/rank",
        data=json.dumps({"texts": texts}).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read())["scores"]


def records(path: str, url: str) -> list[dict]:
    out = []
    for i, (rows, labels) in enumerate(tp.load_groups(path)):
        scores = rank([r["text"] for r in rows], url)
        real = np.array(scores[:-1])
        silence = float(scores[-1])
        top = int(np.argmax(real))
        any_reply = any(labels[:-1])
        out.append(
            {
                "conv_id": rows[0].get("conv_id", ""),
                "any_reply": any_reply,
                "margin": float(np.max(real) - silence),
                "top_is_reply": int(labels[top] == 1) if any_reply else None,
            }
        )
        if (i + 1) % 10 == 0:
            print("ranked", i + 1, flush=True)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:7010")
    ap.add_argument("--val", default="training/data/llm_role/llm_role_val.jsonl")
    ap.add_argument("--test", default="training/data/llm_role/llm_role_test.jsonl")
    ap.add_argument("--out", default="classifier/model/margin.json")
    args = ap.parse_args()
    val = records(args.val, args.url)
    test = records(args.test, args.url)
    margin, vm = tp.calibrate_margin(val)
    tm = tp.group_metrics(test, margin)
    print("service margin", margin)
    print("val", json.dumps(vm, ensure_ascii=False))
    print("test", json.dumps(tm, ensure_ascii=False))
    Path(args.out).write_text(
        json.dumps(
            {"margin": round(float(margin), 6), "val": vm, "test": tm, "source": "classifier-rank"},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print("saved", args.out)


if __name__ == "__main__":
    main()
