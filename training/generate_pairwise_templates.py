#!/usr/bin/env python3
"""生成平衡的 pairwise 角色匹配候选组（模板高多样性，标签确定）。

- 50% 组有明确目标角色 → 该角色分身 reply，其他 silent
- 50% 组为通知/状态/闲聊 → 全体 silent（训练时由 silence 候选承接）
- 不生成具体 @，确保进入运行时模型的 auto/direct 口径
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

from serialize import serialize

ROLES = [
    ("张伟", "项目经理", "项目管理部"),
    ("李娜", "产品经理", "产品部"),
    ("王强", "后端开发", "研发部"),
    ("陈晨", "前端开发", "研发部"),
    ("赵敏", "测试工程师", "质量部"),
    ("刘洋", "UI设计师", "设计部"),
    ("许峰", "运维工程师", "运维部"),
]

REPLY_BY_ROLE = {
    "产品经理": [
        "PRD 里订单筛选的时间范围还是单选吗？请产品确认一下，今天要定稿。",
        "需求优先级麻烦产品排一下，下午评审要用。",
        "这个交互变更影响范围请产品同学评估一下。",
    ],
    "后端开发": [
        "订单接口报错了，后端看一下日志和回调。",
        "分页字段有变更吗？请后端确认接口文档。",
        "支付回调补偿任务麻烦后端今天处理。",
    ],
    "前端开发": [
        "页面联调发现样式错位，前端看一下。",
        "工作台会话列表的 loading 状态请前端改一下。",
        "导出按钮还没接接口，前端今天能完成吗？",
    ],
    "测试工程师": [
        "这版可以提测了，测试安排一下回归。",
        "BUG-203 已修复，测试帮忙验证。",
        "线上冒烟麻烦测试今天走一遍。",
    ],
    "UI设计师": [
        "按钮颜色和间距请 UI 同学再确认一下视觉稿。",
        "工作台卡片层级需要 UI 调整，今天能出终稿吗？",
        "移动端弹窗样式请 UI 看一下。",
    ],
    "运维工程师": [
        "支付回调失败率升高，运维看一下监控和证书。",
        "今晚发布窗口请运维准备回滚和备份。",
        "测试环境权限麻烦运维开一下。",
    ],
    "项目经理": [
        "项目风险请项目经理确认一下，明天要向老板汇报。",
        "联调进度落后了，项目经理看下是否需要调整排期。",
        "上线检查清单请项目经理逐项确认。",
    ],
}

SILENT = [
    "今天下午 3 点开会，会议室 A302。",
    "周报已发群里，大家有空看下。",
    "收到，谢谢。",
    "上线成功，大家辛苦了。",
    "Jira 看板已更新：两个任务状态变更为进行中。",
    "今天中午一起点外卖吗？",
    "文档已同步到 Confluence。",
    "明天上午 10 点站会，别迟到。",
]

CONTEXT = [
    "今天先处理订单模块，其他需求往后排。",
    "收到，我上午把接口文档补一下。",
    "评审会材料我这边准备好了。",
    "测试环境还有两个阻塞问题。",
    "大家注意下今晚的发布窗口。",
    "这个需求优先级比较高，先看。",
]


def build_group(rng: random.Random, idx: int, need_reply: bool) -> list[dict]:
    people = rng.sample(ROLES, 5)
    sender = rng.choice(people)
    target = rng.choice([p for p in people if p[0] != sender[0]]) if need_reply else None
    members = []
    humans = {}
    avatars = {}
    for i, (name, role, dep) in enumerate(people):
        hid, aid = f"u{i}", f"a{i}"
        humans[name] = {"id": hid, "name": name, "type": "human", "role": role, "department": dep}
        avatars[name] = {
            "id": aid, "name": name, "type": "avatar", "owner_id": hid,
            "owner_name": name, "role": role, "department": dep,
        }
        members.append({"id": hid, "name": name, "type": "human", "role": role, "department": dep, "owner_id": None})
        members.append({"id": aid, "name": name, "type": "avatar", "role": role, "department": dep, "owner_id": hid})

    hour = rng.randint(9, 17)
    minute = rng.randint(0, 55)
    context = []
    for j in range(rng.randint(2, 4)):
        who = rng.choice(people)
        context.append({
            "time": f"{hour:02d}:{minute + j * 3:02d}",
            "sender": who[0],
            "sender_role": who[1],
            "sender_department": who[2],
            "sender_type": "human",
            "text": rng.choice(CONTEXT),
            "mentions": [],
            "attachments": [],
        })
    if target:
        text = rng.choice(REPLY_BY_ROLE[target[1]]).replace("请产品", f"请{target[0]}").replace("请后端", f"请{target[0]}")
        text = f"{text}（{target[0]}，{target[1]}）"
    else:
        text = rng.choice(SILENT)
    trigger = {
        "time": f"{hour:02d}:{minute + 15:02d}",
        "sender": sender[0],
        "sender_role": sender[1],
        "sender_department": sender[2],
        "sender_type": "human",
        "text": text,
        "mentions": [],
        "attachments": [],
    }
    samples = []
    for name, role, dep in people:
        if name == sender[0]:
            continue
        avatar = avatars[name]
        sample = {
            "conv_type": "group",
            "conv_id": f"syn_{idx}",
            "members": members,
            "observer": {
                "id": avatar["id"], "name": name, "owner_name": name,
                "owner_role": role, "owner_department": dep, "mode": "auto",
            },
            "context": context,
            "trigger": trigger,
            "label": "reply" if target and name == target[0] else "silent",
            "intent": "task" if target else "notice",
            "source": "synthetic-template",
        }
        sample["text"] = serialize(sample)
        sample["id"] = f"syn_{idx}_{avatar['id']}"
        samples.append(sample)
    return samples


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--groups", type=int, default=400)
    ap.add_argument("--out", default="training/data/pairwise_templates.jsonl")
    ap.add_argument("--seed", type=int, default=20261126)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    with out.open("w", encoding="utf-8") as f:
        for i in range(args.groups):
            need = i % 2 == 0
            for s in build_group(rng, i, need):
                f.write(json.dumps(s, ensure_ascii=False) + "\n")
                total += 1
    print(f"wrote {total} samples / {args.groups} groups -> {out}")


if __name__ == "__main__":
    main()
