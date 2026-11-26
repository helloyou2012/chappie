#!/usr/bin/env python3
"""特征 + 线性 pairwise 角色匹配（CPU 秒级）。

数据全部由大模型生成（train/val/test），不依赖任何真实聊天或 G1001。
- 训练：train 组内候选排序 + 二元交叉熵；
- 阈值：在 val 组上调“组级回复召回 / 沉默误唤醒”平衡；
- 测试：test 组上报 top1、组级指标与样本级指标。
"""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report

ROOT = Path(__file__).resolve().parent.parent

# 角色类别 -> (观察者角色正则, 触发消息职责词正则)
ROLE_KEYS: dict[str, tuple[re.Pattern, re.Pattern]] = {
    "产品": (re.compile(r"产品", re.I), re.compile(r"产品|PRD|需求|原型|优先级|需求评审|功能定义|字段", re.I)),
    "设计": (re.compile(r"设计|UI|交互|视觉", re.I), re.compile(r"设计|视觉|UI|交互|样式|按钮|Banner|间距|设计稿", re.I)),
    "后端": (re.compile(r"后端|服务端|架构|技术负责人|研发|开发", re.I), re.compile(r"后端|服务端|接口|API|数据库|缓存|回调|分页|签名|验签|架构|服务", re.I)),
    "前端": (re.compile(r"前端", re.I), re.compile(r"前端|页面|组件|浏览器|H5|加载速度|首屏", re.I)),
    "测试": (re.compile(r"测试|质量", re.I), re.compile(r"测试|用例|回归|缺陷|BUG|冒烟|验证", re.I)),
    "运维": (re.compile(r"运维|SRE", re.I), re.compile(r"运维|发布|部署|监控|告警|回滚|证书|权限|上线", re.I)),
    "项目": (re.compile(r"项目|PMO|经理|管理", re.I), re.compile(r"项目|排期|进度|风险|评审|站会|会议|待办|协调|里程碑|计划", re.I)),
    "市场": (re.compile(r"市场|运营|品牌|内容|活动|渠道|增长|媒介|投放", re.I), re.compile(r"市场|运营|品牌|活动|渠道|增长|推广|内容|投放|曝光|物料|海报", re.I)),
    "销售": (re.compile(r"销售|商务|客户|商机", re.I), re.compile(r"销售|商务|合同|报价|签约|回款|商机|打单|投标", re.I)),
    "数据": (re.compile(r"数据|分析|ETL|数仓|BI", re.I), re.compile(r"数据|报表|指标|分析|埋点|BI|ETL|数仓|看板|宽表|分区", re.I)),
    "算法": (re.compile(r"算法|机器学习|AI", re.I), re.compile(r"算法|模型|训练|推理|特征|精度|AUC|推荐|召回", re.I)),
    "财务": (re.compile(r"财务|会计", re.I), re.compile(r"财务|预算|报销|发票|成本|结算|付款|账期|税务", re.I)),
    "人力": (re.compile(r"人力|人事|HR|招聘|行政", re.I), re.compile(r"人力|招聘|绩效|培训|入职|组织|薪酬|考勤|面试", re.I)),
    "法务": (re.compile(r"法务|合规|隐私", re.I), re.compile(r"法务|合规|隐私|条款|协议|法律|监管", re.I)),
    "客服": (re.compile(r"客服|客户成功|售后|技术支持", re.I), re.compile(r"客服|用户|工单|投诉|售后|反馈|满意度|续费|退换", re.I)),
    "安全": (re.compile(r"安全|渗透", re.I), re.compile(r"安全|漏洞|渗透|攻击|越权|加密|密钥|等保|安全扫描", re.I)),
    "供应链": (re.compile(r"采购|供应链|供应商|仓储|仓库", re.I), re.compile(r"采购|供应商|比价|询价|物料|库存|物流|到货", re.I)),
    "交付": (re.compile(r"实施|交付|解决方案", re.I), re.compile(r"实施|交付|客户现场|部署|验收|方案|驻场", re.I)),
    "移动端": (
        re.compile(r"Android|iOS|客户端|移动端|Flutter|React Native", re.I),
        re.compile(r"Android|iOS|客户端|App|移动端|Flutter|React Native|安卓|苹果", re.I),
    ),
    "文案": (re.compile(r"文案|编辑", re.I), re.compile(r"文案|标题|脚本|推文|宣传语|稿子|措辞", re.I)),
    "网络": (
        re.compile(r"网络", re.I),
        re.compile(r"网络|带宽|专线|路由|交换机|DNS|CDN|网络故障", re.I),
    ),
}
KEYS = list(ROLE_KEYS)
NEED = re.compile(r"[?？]|吗|呢|怎么|什么|多少|是否|能不能|帮我|帮忙|请|麻烦|确认|处理|安排|看一下|看下|急|马上|尽快|今天|今晚|明天|中午前|下班前|下午|周五|拉一下|核一遍|核一下|过一下|给个|发一下|出一下|处理下|跟进|对一下|跑一下|查一下|改一下|调一下|整理一下")
QUESTION = re.compile(r"[?？]|吗|呢|怎么|什么|多少|是否|能不能|确认下|看下")
TASK = re.compile(r"帮我|请|麻烦|确认|处理|安排|看一下|同步一下|准备|排查|跟进|对接|发一下|定稿|定下来")
NOTICE_CUE = re.compile(
    r"同步|知悉|好消息|已确认|已发送|已归档|已完成|已上线|已发布|已记录|收尾|按计划|推进即可|大家辛苦|就行|供参考"
)
REQUEST_CUE = re.compile(
    r"请|麻烦|帮我|帮忙|看下|看一下|确认下|确认一下|能否|能不能|是否|吗|[?？]|需要你|你这边|跟进|发一下|发我|给个|拉一下|核一下|核对|过一下|查一下|整理一下|处理下|跑一下|同步下|同步一声|尽快|务必|提前|出报告|跑完|修完|定下来"
)


def has_reply_cue(text: str) -> bool:
    if NOTICE_CUE.search(text) and not REQUEST_CUE.search(text):
        return False
    return bool(NEED.search(text))


def feats(sample: dict) -> list[float]:
    members = sample["members"]
    obs = sample["observer"]
    owner = next((m for m in members if m["name"] == obs["name"] and m["type"] == "human"), {})
    role = f"{owner.get('role', '')} {owner.get('department', '')}"
    text = sample["trigger"].get("text", "")
    sender = sample["trigger"].get("sender", "")
    sender_role = next(
        (m.get("role", "") for m in members if m["name"] == sender and m["type"] == "human"), ""
    )
    present = [k for k in KEYS if ROLE_KEYS[k][1].search(text)]
    role_cats = [k for k in KEYS if ROLE_KEYS[k][0].search(role)]
    role_hits = [k for k in role_cats if k in present]
    other_hits = [k for k in present if k not in role_hits]
    context = sample.get("context") or []
    name_hit = bool(owner.get("name") and owner["name"] in text)
    f = [
        1.0,
        1.0 if NEED.search(text) else 0.0,
        1.0 if QUESTION.search(text) else 0.0,
        1.0 if TASK.search(text) else 0.0,
        1.0 if text.strip().endswith(("？", "?")) else 0.0,
        min(len(text), 300) / 300.0,
        min(len(context), 8) / 8.0,
        1.0 if name_hit else 0.0,
        1.0 if role_hits else 0.0,
        float(len(role_hits)),
        float(len(present)),
        1.0 if not present else 0.0,
        1.0 if other_hits else 0.0,
        1.0 if present and not role_hits else 0.0,
        1.0 if name_hit and not present else 0.0,
        1.0 if len(present) == 1 and role_hits else 0.0,
        1.0 if len(present) > 1 and role_hits else 0.0,
        1.0 if any(ROLE_KEYS[k][0].search(sender_role) for k in role_hits) else 0.0,
        1.0 if present and not role_hits and name_hit else 0.0,
        float(len(role_cats)),
        # 角色/姓名命中是否伴随明确回应线索：区分“派活”与“通知里提到角色”
        1.0 if role_hits and NEED.search(text) else 0.0,
        1.0 if role_hits and not NEED.search(text) else 0.0,
        1.0 if name_hit and NEED.search(text) else 0.0,
        1.0 if name_hit and not NEED.search(text) else 0.0,
        1.0 if (role_hits or name_hit) and (QUESTION.search(text) or TASK.search(text)) else 0.0,
        1.0
        if (role_hits or name_hit)
        and not NEED.search(text)
        and not QUESTION.search(text)
        and not TASK.search(text)
        else 0.0,
    ]
    for k in KEYS:
        f.append(1.0 if k in role_cats else 0.0)
    for k in KEYS:
        f.append(1.0 if k in role_hits else 0.0)
    for k in KEYS:
        f.append(1.0 if k in present else 0.0)
    for k in KEYS:
        f.append(1.0 if ROLE_KEYS[k][0].search(sender_role) else 0.0)
    return f


def load(path: str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def groups_of(rows: list[dict]) -> list[list[dict]]:
    groups: dict[str, list[dict]] = {}
    for r in rows:
        groups.setdefault(r["conv_id"], []).append(r)
    return [g for g in groups.values() if len(g) >= 2]


def group_eval(model, rows: list[dict], threshold: float) -> dict:
    gs = groups_of(rows)
    reply_total = reply_hit = silent_total = false_wake = 0
    top1 = []
    for g in gs:
        X = np.array([feats(r) for r in g])
        score = model.decision_function(X)
        has_reply = any(r["label"] == "reply" for r in g)
        # 运行时与训练一致：没有回应线索的纯通知直接沉默，不进入模型
        allow = has_reply_cue(g[0]["trigger"].get("text", ""))
        pred_reply = allow and float(np.max(score)) > threshold
        if has_reply:
            reply_total += 1
            reply_hit += int(pred_reply)
            positives = [i for i, r in enumerate(g) if r["label"] == "reply"]
            top1.append(1.0 if int(np.argmax(score)) in positives else 0.0)
        else:
            silent_total += 1
            false_wake += int(pred_reply)
    recall = reply_hit / reply_total if reply_total else 0.0
    false_rate = false_wake / silent_total if silent_total else 0.0
    return {
        "groups": len(gs),
        "reply_groups": reply_total,
        "reply_recall": round(recall, 4),
        "silent_groups": silent_total,
        "false_wake": false_wake,
        "false_wake_rate": round(false_rate, 4),
        "balanced_acc": round((recall + (1 - false_rate)) / 2, 4),
        "top1": round(float(np.mean(top1)), 4) if top1 else 0.0,
        "threshold": round(float(threshold), 6),
    }


def sample_eval(model, rows: list[dict], threshold: float) -> dict:
    X = np.array([feats(r) for r in rows])
    score = model.decision_function(X)
    allow = np.array([has_reply_cue(r["trigger"].get("text", "")) for r in rows])
    pred = ((score > threshold) & allow).astype(int)
    gold = np.array([1 if r["label"] == "reply" else 0 for r in rows])
    report = classification_report(
        gold, pred, target_names=["silent", "reply"], zero_division=0, output_dict=True
    )
    return {
        "precision": round(report["reply"]["precision"], 4),
        "recall": round(report["reply"]["recall"], 4),
        "f1": round(report["reply"]["f1-score"], 4),
        "accuracy": round(report["accuracy"], 4),
    }


def calibrate(model, rows: list[dict]) -> tuple[float, dict]:
    gs = groups_of(rows)
    all_scores = []
    for g in gs:
        all_scores.append(float(np.max(model.decision_function(np.array([feats(r) for r in g])))))
    cands = sorted(set(all_scores))
    cands = [cands[0] - 1e-3] + [(a + b) / 2 for a, b in zip(cands, cands[1:])] + [cands[-1] + 1e-3]
    best_t, best, best_key = 0.0, None, None
    for t in cands:
        m = group_eval(model, rows, t)
        s = sample_eval(model, rows, t)
        # 组级平衡 + 候选级 F1：避免阈值过松导致“每组都回、但回错人”
        score = 0.5 * (m["balanced_acc"] + s["f1"])
        key = (round(score, 6), m["balanced_acc"], s["f1"], -m["false_wake_rate"], m["top1"], -abs(t))
        if best is None or key > best_key:
            best_t, best, best_key = t, m, key
    return best_t, best


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--train", default="training/data/llm_role/llm_role_train.jsonl")
    ap.add_argument("--val", default="training/data/llm_role/llm_role_val.jsonl")
    ap.add_argument("--test", default="training/data/llm_role/llm_role_test.jsonl")
    ap.add_argument("--extra-train", default="")
    ap.add_argument("--llm-weight", type=float, default=3.0)
    ap.add_argument("--out-model", default="training/out/linear-pairwise-llm.json")
    ap.add_argument("--out-metrics", default="training/out/linear-pairwise-llm.metrics.json")
    args = ap.parse_args()

    llm_train = load(args.train)
    extra = load(args.extra_train) if args.extra_train else []
    if extra:
        print("llm-train", len(llm_train), "extra-train", len(extra), args.extra_train)
    train = llm_train + extra
    val = load(args.val)
    test = load(args.test)
    X = np.array([feats(r) for r in train])
    y = np.array([1 if r["label"] == "reply" else 0 for r in train])
    w = np.array(
        [args.llm_weight] * len(llm_train) + [1.0] * len(extra),
        dtype=float,
    )
    model = LogisticRegression(max_iter=4000, class_weight="balanced", C=0.8)
    model.fit(X, y, sample_weight=w)

    threshold, val_metrics = calibrate(model, val)
    test_metrics = group_eval(model, test, threshold)
    test_sample = sample_eval(model, test, threshold)
    train_metrics = group_eval(model, train, threshold)
    print("train", len(train), "val", len(val), "test", len(test))
    print("val", json.dumps(val_metrics, ensure_ascii=False))
    print("test", json.dumps(test_metrics, ensure_ascii=False))
    print("test-sample", json.dumps(test_sample, ensure_ascii=False))
    print("train-group", json.dumps(train_metrics, ensure_ascii=False))
    print("features", X.shape[1])

    out = Path(args.out_model)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "kind": "linear-pairwise",
                "features": "role-match-v2",
                "roles": KEYS,
                "coef": model.coef_[0].tolist(),
                "intercept": float(model.intercept_[0]),
                "threshold": round(float(threshold), 6),
                "trained_on": "llm-generated",
                "train_groups": len(groups_of(train)),
                "val": val_metrics,
                "test": test_metrics,
                "test_sample": test_sample,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    Path(args.out_metrics).write_text(
        json.dumps(
            {"val": val_metrics, "test": test_metrics, "test_sample": test_sample, "train": train_metrics},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print("saved", out)


if __name__ == "__main__":
    main()
