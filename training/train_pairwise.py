#!/usr/bin/env python3
"""Pairwise/listwise 角色匹配训练。

同一触发消息下，把所有观察者分身作为候选，让模型在候选间排序：
正样本（应回复）的 reply logit 要高于同组负样本；同时保留少量 BCE 做概率校准。

输入：llm_role_train.jsonl / llm_role_test.jsonl（大模型生成，含职位/部门）
训练/测试按生成组切分，不使用真实群或 G1001。
"""
from __future__ import annotations

import argparse
import json
import math
import random
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import classification_report
from serialize import serialize
from transformers import AutoModelForSequenceClassification, AutoTokenizer

ROOT = Path(__file__).resolve().parent.parent


def is_specific(r: dict) -> bool:
    return any(
        not (isinstance(m, dict) and m.get("type") == "broadcast")
        for m in (r["trigger"].get("mentions") or [])
    )


def group_key(r: dict):
    t = r["trigger"]
    return (r["conv_id"], t.get("time"), t.get("text"), t.get("sender"))


def load_groups(path: str):
    groups = defaultdict(list)
    for line in open(path, encoding="utf-8"):
        r = json.loads(line)
        if is_specific(r):
            continue
        groups[group_key(r)].append(r)
    out = []
    for rows in groups.values():
        rows.sort(key=lambda x: x.get("id") or x["observer"]["id"])
        labels = [1 if x["label"] == "reply" else 0 for x in rows]
        # 同一组追加一个「保持沉默」候选：全 silent 组由它作为正样本，
        # 有回复的组它作为负样本，模型因此能学到“全体都不回”。
        base = dict(rows[0])
        any_reply = any(labels)
        silence = dict(base)
        silence["observer"] = {
            "id": "__silence__",
            "name": "保持沉默",
            "owner_name": "无",
            "owner_role": "",
            "owner_department": "",
            "mode": "auto",
        }
        silence["label"] = "silent" if any_reply else "reply"
        silence["id"] = f"{base.get('id') or base['observer']['id']}_silence"
        silence["text"] = serialize(silence)
        rows = rows + [silence]
        labels = labels + [0 if any_reply else 1]
        out.append((rows, labels))
    return out


def encode(tok, texts: list[str], max_len: int):
    x = tok(texts, padding=True, truncation=True, max_length=max_len, return_tensors="pt")
    return x


def evaluate_records(groups, forward_group):
    """返回每组的 margin = max(真实候选 reply logit) - silence logit。"""
    model.eval()
    records = []
    with torch.no_grad():
        for rows, labels in groups:
            logits = forward_group(rows)
            scores = logits[:, 1].detach().cpu().numpy()
            real = scores[:-1]
            silence = float(scores[-1])
            top = int(np.argmax(real)) if len(real) else 0
            any_reply = any(labels[:-1])
            records.append(
                {
                    "conv_id": rows[0].get("conv_id", ""),
                    "any_reply": any_reply,
                    "margin": float(np.max(real) - silence) if len(real) else float("-inf"),
                    "top_is_reply": int(labels[top] == 1) if any_reply and len(real) else None,
                    "labels": labels,
                    "scores": [float(x) for x in scores],
                }
            )
    model.train()
    return records


def group_metrics(records, margin):
    reply_total = reply_hit = silent_total = false_wake = 0
    top1 = []
    for r in records:
        pred_reply = r["margin"] >= margin
        if r["any_reply"]:
            reply_total += 1
            reply_hit += int(pred_reply)
            if r["top_is_reply"] is not None:
                top1.append(float(r["top_is_reply"]))
        else:
            silent_total += 1
            false_wake += int(pred_reply)
    recall = reply_hit / reply_total if reply_total else 0.0
    false_rate = false_wake / silent_total if silent_total else 0.0
    return {
        "groups": len(records),
        "reply_groups": reply_total,
        "reply_recall": round(recall, 4),
        "silent_groups": silent_total,
        "false_wake": false_wake,
        "false_wake_rate": round(false_rate, 4),
        "balanced_acc": round((recall + (1 - false_rate)) / 2, 4),
        "top1": round(float(np.mean(top1)), 4) if top1 else 0.0,
        "margin": round(float(margin), 6),
    }


def calibrate_margin(records):
    margins = sorted({r["margin"] for r in records})
    cands = [margins[0] - 1e-3]
    cands += [(a + b) / 2 for a, b in zip(margins, margins[1:])]
    cands += [margins[-1] + 1e-3]
    best = None
    for t in cands:
        m = group_metrics(records, t)
        # 组级平衡 + 目标 top1；同等分时优先更少误唤醒
        score = 0.5 * (m["balanced_acc"] + m["top1"])
        key = (round(score, 6), m["balanced_acc"], m["top1"], -m["false_wake_rate"], -abs(t))
        if best is None or key > best[0]:
            best = (key, t, m)
    assert best is not None

    # val 常见“完美间隔”：回复 margin 远高于沉默 margin。中点过于保守，
    # 会在 test 漏掉低分回复。把阈值放在沉默最大 margin 之上 10% gap 处：
    # 对 val 仍保持 0 误唤醒，同时尽量保留低分回复。
    reply = [r["margin"] for r in records if r["any_reply"]]
    silent = [r["margin"] for r in records if not r["any_reply"]]
    if reply and silent:
        gap = min(reply) - max(silent)
        if gap > 0:
            t = max(silent) + max(0.5, 0.1 * gap)
            m = group_metrics(records, t)
            if key_score := 0.5 * (m["balanced_acc"] + m["top1"]):
                if m["false_wake"] == 0 and key_score >= best[0][0] - 1e-9:
                    return t, m
    return best[1], best[2]


def main() -> None:
    global model
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", default="training/data/llm_role/llm_role_train.jsonl")
    ap.add_argument("--val", default="training/data/llm_role/llm_role_val.jsonl")
    ap.add_argument("--test", default="training/data/llm_role/llm_role_test.jsonl")
    ap.add_argument("--base-model", default="jhu-clsp/mmBERT-base")
    ap.add_argument("--output", default="training/out/mmbert-pairwise-llm")
    ap.add_argument("--epochs", type=int, default=5)
    ap.add_argument("--groups-batch", type=int, default=2)
    ap.add_argument("--max-length", type=int, default=576)
    ap.add_argument("--lr", type=float, default=3e-5)
    ap.add_argument("--freeze-encoder", action="store_true")
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--threads", type=int, default=0)
    args = ap.parse_args()

    train_groups = load_groups(args.train)
    val_groups = load_groups(args.val)
    test_groups = load_groups(args.test)
    print("groups train", len(train_groups), "val", len(val_groups), "test", len(test_groups))

    tok = AutoTokenizer.from_pretrained(args.base_model)
    model = AutoModelForSequenceClassification.from_pretrained(
        args.base_model, num_labels=2, ignore_mismatched_sizes=True
    )
    if args.cpu:
        device = torch.device("cpu")
    elif torch.cuda.is_available():
        device = torch.device("cuda")
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
    else:
        device = torch.device("cpu")
    if args.threads > 0:
        torch.set_num_threads(args.threads)
    if args.freeze_encoder:
        for name, param in model.named_parameters():
            if "classifier" not in name and "score" not in name and "head" not in name:
                param.requires_grad = False
    model.to(device)

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    total_steps = args.epochs * max(1, len(train_groups) // max(1, args.groups_batch))
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda step: min(1.0, (step + 1) / max(1, total_steps // 10))
    )
    bce = torch.nn.BCEWithLogitsLoss()

    def forward_group(rows):
        x = encode(tok, [r["text"] for r in rows], args.max_length)
        x = {k: v.to(device) for k, v in x.items()}
        logits = model(**x).logits
        return logits

    def group_loss(rows, labels):
        logits = forward_group(rows)
        target = torch.tensor(labels, device=device, dtype=torch.float32)
        loss_bce = bce(logits[:, 1], target)
        scores = logits[:, 1]
        pos_idx = [i for i, y in enumerate(labels) if y == 1]
        if pos_idx and len(pos_idx) < len(labels):
            logp = torch.log_softmax(scores, dim=0)
            loss_rank = -logp[pos_idx].mean()
            return loss_bce + 0.5 * loss_rank, logits
        return loss_bce, logits

    reply_groups = [g for g in train_groups if any(g[1][:-1])]
    silent_groups = [g for g in train_groups if not any(g[1][:-1])]
    print("balanced pools reply", len(reply_groups), "silent", len(silent_groups))

    model.train()
    rng = random.Random(42)
    best_score = -1.0
    best_state = None
    best_margin = 0.0
    for epoch in range(1, args.epochs + 1):
        n = min(len(reply_groups), len(silent_groups))
        epoch_groups = rng.sample(reply_groups, n) + rng.sample(silent_groups, n)
        rng.shuffle(epoch_groups)
        losses = []
        for start in range(0, len(epoch_groups), args.groups_batch):
            opt.zero_grad()
            batch = epoch_groups[start : start + args.groups_batch]
            total_loss = None
            for rows, labels in batch:
                loss, _ = group_loss(rows, labels)
                total_loss = loss if total_loss is None else total_loss + loss
                losses.append(loss.item())
            assert total_loss is not None
            (total_loss / len(batch)).backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
        val_records = evaluate_records(val_groups, forward_group)
        margin, val_metrics = calibrate_margin(val_records)
        score = 0.5 * (val_metrics["balanced_acc"] + val_metrics["top1"])
        if score > best_score:
            best_score = score
            best_margin = margin
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
        print(
            f"epoch {epoch} loss {np.mean(losses):.4f} "
            f"val R {val_metrics['reply_recall']:.3f} FW {val_metrics['false_wake_rate']:.3f} "
            f"top1 {val_metrics['top1']:.3f} margin {margin:.3f} best {best_score:.3f}",
            flush=True,
        )

    if best_state is not None:
        model.load_state_dict(best_state)
    val_records = evaluate_records(val_groups, forward_group)
    test_records = evaluate_records(test_groups, forward_group)
    val_metrics = group_metrics(val_records, best_margin)
    test_metrics = group_metrics(test_records, best_margin)
    print("val", json.dumps(val_metrics, ensure_ascii=False))
    print("test", json.dumps(test_metrics, ensure_ascii=False))

    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(out)
    tok.save_pretrained(out)
    labels = [
        {"label": "silent", "intent": "chat", "needReply": False},
        {"label": "reply", "intent": "chat", "needReply": True},
    ]
    (out / "labels.json").write_text(json.dumps(labels, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "margin.json").write_text(
        json.dumps(
            {
                "margin": round(float(best_margin), 6),
                "val": val_metrics,
                "test": test_metrics,
                "max_length": args.max_length,
                "train_groups": len(train_groups),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"saved -> {out}")


if __name__ == "__main__":
    main()
