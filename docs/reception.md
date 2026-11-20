# 接待权（Reception / Delegation）

> 本文回答：**谁有权在当前会话发言、如何切换、如何审计**。实现状态见 [status.md](status.md)。

## 1. 两个正交维度

| 维度      | 取值                                                                                | 含义                 |
| --------- | ----------------------------------------------------------------------------------- | -------------------- |
| Authority | `human` / `avatar` / `paused`                                                       | 此刻谁被授权对外发言 |
| Strategy  | `summon` / `assist` / `full` / `screen` / `decline` / `escalate` / `silent` / `off` | 分身具体怎么处理消息 |

旧档位是兼容预设：

| 档位     | Authority | Strategy |
| -------- | --------- | -------- |
| `manual` | human     | summon   |
| `draft`  | human     | assist   |
| `auto`   | avatar    | full     |
| `off`    | human     | off      |

## 2. 作用域与优先级

1. 会话级委托（最高）
2. 用户显式选择的会话档位（`member.ai_mode_source=explicit`）
3. 联系人
4. 联系人分组标签
5. 日程/时段
6. 全局
7. 默认（manual）

约束字段（风险上限、禁区、能力白名单、频率）始终叠加，取最严格值。
联系人级 `forceHuman` 是紧急穿透，最终强制覆盖为真人接待；`alwaysNotify` 让筛选/静默仍提醒主人。

## 3. 数据模型

- `delegation`：授权事实源（owner、scope、state、strategy、schedule、version、有效期）。
- `conversation_reception`：按会话投影，发送路径只读这一行。
- `delegation_event`：授权变更 append-only 审计。
- `human_request`：对端请求真人，30 分钟限流。
- `contact_tag` / `contact_tag_member`：联系人分组。

每次授权变化递增 `conversation_reception.version`。AI 发送时携带捕获的版本；
core 在消息写入事务内校验，不匹配返回 `AUTHORITY_STALE`，交接窗口返回 `HANDOFF_WINDOW`。

## 4. 切换流程

```text
主人点击接管
  → core 同步写 state=human、version+1、handoff_until=now+2s
  → outbox reception.changed / takeover.requested
  → AI 取消任务、作废审批、冷却 15 分钟、生成 ReceptionDigestCard
  → 旧 AI 发送被版本围栏拒绝
```

对端请求真人：

```text
对端请求 → core 限流 + human_request
  → AI 推送 HumanRequestCard
  → 主人批准 → core 切换 human / 通知对端
  → 主人拒绝/超时 → 保持 avatar
```

## 5. 接口

```http
GET  /api/v1/conversations/:id/reception
PUT  /api/v1/conversations/:id/reception
POST /api/v1/conversations/:id/takeover
POST /api/v1/conversations/:id/release
POST /api/v1/conversations/:id/request-human
GET  /api/v1/reception/delegations
POST /api/v1/reception/delegations
DELETE /api/v1/reception/delegations/:id
```

WS：`reception_changed`（convId、ownerId、state、strategy、version、until、reason）。

## 6. 安全底线

- AI 消息必须带 AI 身份，不伪装真人。
- 高风险话题强制升级；接管后旧回合不可发送。
- 授权变更全程审计；对端请求只能请求，不能强制。
- 当前为服务端可读模型，端到端加密为后续能力。
