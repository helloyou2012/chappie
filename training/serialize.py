"""把一条“观察者视角”的会话样本序列化为 mmBERT 输入文本。

训练与 Bun 运行时必须使用完全相同的格式。
"""
from __future__ import annotations

from typing import Any

TYPE_LABEL = {"human": "真人", "avatar": "分身", "system": "系统", "broadcast": "广播"}


def _person(name: str, role: str = "", department: str = "") -> str:
    parts = [p for p in (role, department) if p]
    return f"{name}（{'，'.join(parts)}）" if parts else name


def _clip(text: str, n: int = 120) -> str:
    text = (text or "").replace("\n", " ").strip()
    return text[:n] + ("…" if len(text) > n else "")


def _attachment_suffix(attachments: list | None) -> str:
    if not attachments:
        return ""
    names = [a.get("name", "") for a in attachments if isinstance(a, dict) and a.get("name")]
    return f"（附件：{'、'.join(names)}）" if names else ""


def _mention_suffix(mentions: list | None) -> str:
    if not mentions:
        return ""
    parts = []
    for m in mentions:
        if isinstance(m, dict):
            typ = TYPE_LABEL.get(m.get("type", ""), "")
            parts.append(f"{m.get('name', '')}·{typ}" if typ else str(m.get("name", "")))
        else:
            parts.append(str(m))
    return "（@" + "、".join(parts) + "）"


def serialize(sample: dict[str, Any]) -> str:
    conv = "群聊" if sample["conv_type"] == "group" else "私聊"
    observer = sample["observer"]
    members = sample.get("members", [])
    lines = [f"[{conv}]"]
    lines.append(
        f"观察者：{observer['name']} 的 AI 分身（主人："
        f"{_person(observer.get('owner_name', ''), observer.get('owner_role', ''), observer.get('owner_department', ''))}；"
        f"模式：{observer.get('mode', 'auto')}）"
    )
    member_parts = []
    for m in members:
        label = TYPE_LABEL.get(m.get("type", "human"), m.get("type", ""))
        extra = "，观察者" if m.get("id") == observer.get("id") else ""
        member_parts.append(
            f"{_person(m.get('name', ''), m.get('role', ''), m.get('department', ''))}({label}{extra})"
        )
    lines.append("成员：" + "、".join(member_parts))
    lines.append("最近消息：")
    for msg in sample.get("context", [])[-5:]:
        sender = msg.get("sender", "")
        typ = TYPE_LABEL.get(msg.get("sender_type", "human"), "")
        lines.append(
            f"[{msg.get('time', '')}] "
            f"{_person(sender, msg.get('sender_role', ''), msg.get('sender_department', ''))}({typ})："
            f"{_clip(msg.get('text', ''))}"
            f"{_mention_suffix(msg.get('mentions'))}{_attachment_suffix(msg.get('attachments'))}"
        )
    trig = sample["trigger"]
    typ = TYPE_LABEL.get(trig.get("sender_type", "human"), "")
    mentioned_self = any(
        isinstance(m, dict)
        and m.get("name") == observer.get("name")
        and m.get("type") == "avatar"
        for m in (trig.get("mentions") or [])
    )
    lines.append(f"观察者是否被 @：{'是' if mentioned_self else '否'}")
    lines.append("当前消息：")
    lines.append(
        f"[{trig.get('time', '')}] "
        f"{_person(trig.get('sender', ''), trig.get('sender_role', ''), trig.get('sender_department', ''))}({typ})："
        f"{_clip(trig.get('text', ''), 240)}{_mention_suffix(trig.get('mentions'))}"
        f"{_attachment_suffix(trig.get('attachments'))}"
    )
    lines.append("请判断：观察者是否应该回复当前消息？")
    return "\n".join(lines)
