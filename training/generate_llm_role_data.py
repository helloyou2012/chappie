#!/usr/bin/env python3
"""用大模型生成带标注的角色分工群聊数据（train/val/test）。

- 回复组/沉默组分别生成，保证组级 50/50；
- 大模型写群成员、角色、上下文、触发消息，并给出每个观察者 reply/silent 标签；
- 脚本做结构与一致性校验，输出 serialize.py 格式；
- 不依赖任何真实聊天/G1001 数据。
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import urllib.request
from pathlib import Path

from serialize import serialize

ROOT = Path(__file__).resolve().parent.parent
ROLE_MARKERS = {
    "产品": ("产品", "需求", "PRD", "原型", "功能"),
    "设计": ("设计", "UI", "交互", "视觉", "样式"),
    "后端": ("后端", "服务端", "接口", "API", "数据库", "架构", "开发"),
    "前端": ("前端", "页面", "组件", "浏览器", "H5"),
    "测试": ("测试", "用例", "回归", "缺陷", "BUG", "验证"),
    "运维": ("运维", "发布", "部署", "监控", "告警", "线上"),
    "项目": ("项目", "排期", "进度", "风险", "会议", "协调"),
    "市场": ("市场", "运营", "活动", "品牌", "增长", "渠道", "内容", "推广", "媒介", "投放"),
    "销售": ("销售", "商务", "客户", "合同", "报价", "签约"),
    "数据": ("数据", "报表", "指标", "分析", "埋点", "BI", "ETL", "数仓", "看板", "宽表", "分区"),
    "算法": ("算法", "机器学习", "AI", "模型", "训练", "推理", "特征", "精度", "AUC", "推荐", "召回"),
    "财务": ("财务", "预算", "报销", "发票", "成本", "结算"),
    "人力": ("人力", "招聘", "绩效", "培训", "入职", "组织", "行政"),
    "法务": ("法务", "合规", "隐私", "条款", "协议", "风险"),
    "客服": ("客服", "用户", "工单", "投诉", "售后", "反馈", "技术支持"),
    "安全": ("安全", "渗透", "漏洞", "攻击", "越权", "加密", "密钥", "等保"),
    "供应链": ("采购", "供应链", "供应商", "比价", "询价", "物料", "库存", "物流", "到货", "仓储", "仓库"),
    "交付": ("实施", "交付", "解决方案", "客户现场", "部署", "验收", "方案", "驻场"),
    "移动端": ("Android", "iOS", "客户端", "移动端", "Flutter", "React Native", "App"),
    "文案": ("文案", "编辑", "标题", "脚本", "推文", "宣传语", "稿子"),
    "网络": ("网络", "带宽", "专线", "路由", "交换机", "DNS", "CDN", "网络故障"),
}


def load_env() -> None:
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s and not s.startswith("#") and "=" in s:
            k, v = s.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def call_llm(prompt: str) -> list[dict]:
    base = os.environ["MODEL_BASE_URL"].rstrip("/")
    key = os.environ["MODEL_API_KEY"]
    model = os.environ["MODEL_NAME"]
    body = {
        "model": model,
        "max_tokens": 6000,
        "temperature": 0.9,
        "thinking": {"type": "disabled"},
        "messages": [{"role": "user", "content": prompt}],
    }
    req = urllib.request.Request(
        f"{base}/v1/messages",
        data=json.dumps(body).encode(),
        headers={
            "content-type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as res:
        data = json.loads(res.read())
    text = "\n".join(
        b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"
    )
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    m = re.search(r"\[[\s\S]*\]", text)
    if not m:
        raise RuntimeError("no JSON array")
    return json.loads(m.group(0))


def prompt(kind: str, n: int, seed: int) -> str:
    common = f"""生成 {n} 个中文工作群聊样本，输出 JSON 数组。seed={seed}。

每个样本：
{{
 "group_name": "...",
 "members": [{{"id":"u1","name":"张伟","role":"项目经理","department":"项目管理部","type":"human","owner_id":null}}, {{"id":"a1","name":"张伟","role":"项目经理","department":"项目管理部","type":"avatar","owner_id":"u1"}}, ...],
 "context": [{{"time":"09:01","sender":"张伟","sender_type":"human","text":"..."}}],
 "trigger": {{"time":"09:10","sender":"李娜","sender_type":"human","text":"..."}},
 "labels": [{{"observer":"张伟","reply":false}}, ...]
}}

硬性要求：
- 4-6 个真人（不同角色/部门）+ 每人一个同名 avatar；不要系统成员。
- labels 覆盖所有非发送者真人（发送者自己的 avatar 不参与）。
- 不要出现 @具体成员，也不要 @所有人。
- 时间 HH:MM 递增；自然中文，贴近真实工作群。
- 只输出 JSON 数组。"""
    if kind == "reply":
        return common + """
本批全部是“需要某个分身回复”的组：
- trigger 不含 @，但通过职责词或姓名明确指向某个角色/某人（如“请产品确认”“后端看下接口”“张伟你跟进下”）。
- trigger 必须是需要该角色回应的任务/问题/紧急事项。
- 恰好 1 个（最多 2 个）非发送者分身 reply=true，且必须是承担该职责的角色；其他全部 false。
- 标签理由要说明职责匹配。
"""
    return common + """
本批全部是“所有分身都应沉默”的组：
- trigger 是通知、公告、进度同步、闲聊、已闭环信息，或只是在陈述事实。
- 所有非发送者分身 reply=false。
- 不要把任务派给任何人；不要提问要求回应。
"""


def valid_group(g: dict, kind: str) -> bool:
    try:
        humans = [m for m in g["members"] if m.get("type") == "human"]
        avatars = [m for m in g["members"] if m.get("type") == "avatar"]
        if not (4 <= len(humans) <= 6) or len(humans) != len(avatars):
            return False
        hnames = {m["name"] for m in humans}
        anames = {m["name"] for m in avatars}
        if hnames != anames:
            return False
        trig = g["trigger"]
        if trig.get("sender") not in hnames:
            return False
        if "@" in trig.get("text", "") or "@" in "".join(c.get("text", "") for c in g.get("context", [])):
            return False
        labels = {x["observer"]: bool(x.get("reply")) for x in g.get("labels", []) if x.get("observer") in hnames}
        expect = hnames - {trig["sender"]}
        if not labels or not (set(labels) & expect):
            return False
        replies = [name for name, reply in labels.items() if reply]
        if kind == "reply" and not replies:
            return False
        if kind == "silent" and replies:
            return False
        return True
    except Exception:  # noqa: BLE001
        return False


def normalize_group(g: dict) -> list[dict]:
    members = []
    humans: dict[str, dict] = {}
    avatars: dict[str, dict] = {}
    for m in g["members"]:
        members.append(
            {
                "id": str(m["id"]),
                "name": m["name"],
                "type": m["type"],
                "role": m.get("role", ""),
                "department": m.get("department", ""),
                "owner_id": m.get("owner_id"),
            }
        )
        if m["type"] == "human":
            humans[m["name"]] = m
        elif m["type"] == "avatar":
            avatars[m["name"]] = m
    trig = g["trigger"]
    sender = trig["sender"]
    labels = {
        x["observer"]: bool(x.get("reply"))
        for x in g["labels"]
        if x.get("observer") in humans and x["observer"] != sender
    }
    trigger = {
        "time": trig["time"],
        "sender": sender,
        "sender_type": "human",
        "sender_role": humans[sender].get("role", ""),
        "sender_department": humans[sender].get("department", ""),
        "text": trig["text"],
        "mentions": [],
        "attachments": [],
    }
    context = [
        {
            "time": c["time"],
            "sender": c["sender"],
            "sender_type": "human",
            "sender_role": humans.get(c["sender"], {}).get("role", ""),
            "sender_department": humans.get(c["sender"], {}).get("department", ""),
            "text": c["text"],
            "mentions": [],
            "attachments": [],
        }
        for c in g.get("context", [])
    ]
    out = []
    for name, human in humans.items():
        if name == sender:
            continue
        avatar = avatars.get(name)
        if not avatar:
            continue
        sample = {
            "conv_type": "group",
            "conv_id": g.get("group_name", "llm"),
            "members": members,
            "observer": {
                "id": avatar["id"],
                "name": name,
                "owner_name": name,
                "owner_role": human.get("role", ""),
                "owner_department": human.get("department", ""),
                "mode": "auto",
            },
            "context": context,
            "trigger": trigger,
            "label": "reply" if labels.get(name) else "silent",
            "intent": "task",
        }
        sample["text"] = serialize(sample)
        out.append(sample)
    return out


def role_hit(text: str, role: str) -> bool:
    for keys in ROLE_MARKERS.values():
        if any(k in role for k in keys) and any(k in text for k in keys):
            return True
    return False


def consistent(g: dict) -> bool:
    """回复标签至少要和职责词/点名的逻辑对得上，减少 LLM 标签噪声。"""
    trig = g["trigger"]
    text = trig["text"]
    humans = {m["name"]: m for m in g["members"] if m["type"] == "human"}
    labels = [(x["observer"], bool(x.get("reply"))) for x in g["labels"]]
    for name, reply in labels:
        if reply and not (name in text or role_hit(text, humans[name].get("role", ""))):
            return False
    return True


def gen_split(
    kind: str, count: int, batch: int, rng: random.Random, split: str, outdir: Path
) -> list[dict]:
    cache_path = outdir / f"cache_{split}_{kind}.jsonl"
    rows: list[dict] = []
    if cache_path.exists():
        with cache_path.open(encoding="utf-8") as f:
            rows = [json.loads(line) for line in f if line.strip()]
    made = len({r["conv_id"] for r in rows})
    print(f"{split}/{kind} resume {made}/{count}", flush=True)
    attempts = 0
    max_attempts = max(20, (count - made) * 4)
    with cache_path.open("a", encoding="utf-8") as cache:
        while made < count and attempts < max_attempts:
            attempts += 1
            n = min(batch, count - made)
            try:
                groups = call_llm(prompt(kind, n, rng.randint(1, 10**9)))
            except Exception as e:  # noqa: BLE001
                print(f"{split}/{kind} llm failed: {e}", flush=True)
                continue
            groups = [
                g
                for g in groups
                if isinstance(g, dict) and valid_group(g, kind) and consistent(g)
            ]
            if not groups:
                print(f"{split}/{kind} batch all invalid ({len(groups)})", flush=True)
                continue
            for g in groups[:n]:
                g["group_name"] = f"llm_{split}_{kind}_{made}_{rng.randint(1000, 9999)}"
                part = normalize_group(g)
                rows.extend(part)
                for r in part:
                    cache.write(json.dumps(r, ensure_ascii=False) + "\n")
                made += 1
                if made >= count:
                    break
            cache.flush()
            print(f"{split}/{kind} groups {made}/{count}", flush=True)
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--train-groups", type=int, default=120)
    ap.add_argument("--val-groups", type=int, default=40)
    ap.add_argument("--test-groups", type=int, default=60)
    ap.add_argument("--batch", type=int, default=5)
    ap.add_argument("--seed", type=int, default=20261127)
    ap.add_argument("--out-dir", default="training/data/llm_role")
    args = ap.parse_args()
    load_env()
    rng = random.Random(args.seed)
    outdir = ROOT / args.out_dir
    outdir.mkdir(parents=True, exist_ok=True)

    splits = {
        "train": (args.train_groups, 0.5),
        "val": (args.val_groups, 0.5),
        "test": (args.test_groups, 0.5),
    }
    for split, (total, ratio) in splits.items():
        n_reply = int(total * ratio)
        n_silent = total - n_reply
        rows = gen_split("reply", n_reply, args.batch, rng, split, outdir)
        rows += gen_split("silent", n_silent, args.batch, rng, split, outdir)
        rng.shuffle(rows)
        path = outdir / f"llm_role_{split}.jsonl"
        with path.open("w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"{split}: {len(rows)} samples -> {path}", flush=True)


if __name__ == "__main__":
    main()
