# 实现要点与代码结构

> 本文回答：**代码是怎么组织的、关键机制落在哪个文件**。
> 架构目标见 [system-design.md](system-design.md)，设计纪律见 [design-essence.md](design-essence.md)，
> 功能完成度与限制见 [status.md](status.md)。

## 目录

1. [代码地图](#1-代码地图)
2. [契约先行](#2-契约先行)
3. [im-core（Rust 核心）](#3-im-corerust-核心)
4. [ai-platform（Bun AI 平台）](#4-ai-platformbun-ai-平台)
5. [端云一体](#5-端云一体)
6. [客户端](#6-客户端)
7. [工程约定](#7-工程约定)

## 1. 代码地图

```
chappie/
├── packages/
│   ├── contract/   # 契约唯一真相（zod）：实体 / WS 帧 / REST DTO / outbox 事件 / AI 数据
│   └── shared/     # 三端复用：API/WS 客户端、zustand 状态、离线队列、设备能力、头像色板、拼音分组
├── core/           # Rust im-core（cargo workspace）
│   ├── migrations/ # core 表（sqlx migrate，启动自动执行、编译期嵌入）
│   └── crates/{common,store,chat,internal-api,gateway,im-core}
├── ai/             # Bun ai-platform
│   ├── migrations/ # AI 表（bun src/migrate.ts）
│   └── src/        # router / policy / classifier / agent-runtime / tool-gateway /
│                   # trust / prompt / turn-guard / silence / memory / model-gateway /
│                   # approval / recovery / scheduler / admin-api / common/push 等
├── apps/
│   ├── web/        # React 19 + Vite 8 + Tailwind v4 + @base-ui/react；components/ui 为设计系统
│   ├── desktop/    # Tauri 2（复用 apps/web）
│   └── mobile/     # Expo SDK 58 + expo-router
│       └── src/ui/ # 移动端设计系统；src/push.ts 推送；src/config.ts 构建期地址；src/store/theme.ts 主题
├── deploy/         # docker-compose（本地基础设施）、remote-deploy.sh
└── docs/           # 设计与规范文档（入口：docs/README.md）
```

## 2. 契约先行

`packages/contract` 以 **zod schema 作为唯一契约源**（实体、WS 帧、REST DTO、outbox 事件、AI 数据），
三端与 Bun 直接复用（含运行时校验）；Rust 侧以 serde 结构逐字段对齐（camelCase）。

防漂移：契约包导出 `fixtures.json`，TS 侧 `bun test` 与 Rust 侧
`cargo test -p im-core-chat` 读取**同一份**样例做往返校验。

```bash
pnpm --filter @chappie/contract export:fixtures
pnpm test:contract
cargo test --manifest-path core/Cargo.toml -p im-core-chat
```

Rust ↔ Bun 内部契约使用 **HTTP JSON**（`127.0.0.1:7001 /internal/v1/*`，
`X-Internal-Token` + `X-Trace-Id`）。

## 3. im-core（Rust 核心）

- **单写者**：消息只由 `chat::send_message` 写入，人类 WS 与 AI 内部 API 走同一路径。
- **发送事务**：`(sender_id, client_msg_id)` 幂等 → 行锁分配 seq → 消息 + outbox 同事务。
- **分身代发强校验**：`on_behalf_of` 必须等于主人；`hop_count` 超限拒绝（防 AI 互聊死循环）。
- **WS 网关**：首帧鉴权、心跳/空闲断开、有界队列背压（客户端按 seq 补洞）。
- **fanout**：进程内 broadcast + Redis Pub/Sub；Redis 不可用时退化为单节点。
- **outbox**：`FOR UPDATE SKIP LOCKED` 由 Bun 消费，PG 咨询锁保证同会话事件有序。
- **设备与多端**：`device` 表记录平台/版本/能力/pushToken；`GET /api/v1/devices` 供客户端展示多端状态。
- **会话列表**：「我的分身」系统会话固定置顶；群聊预览返回 `lastMsgSenderName`。

## 4. ai-platform（Bun AI 平台）

```
outbox-worker ──► pipeline ──┬─► router（候选分身）
                             ├─► policy（档位/让位/冷却/限流/预算/禁区话题）
                             ├─► classifier（规则意图分类 + confidence）
                             └─► agent-runtime
                                   ├─ prompt（有界上下文 + 主人/数据分区）
                                   ├─ turn-guard（每轮/每工具/交付前撤权）
                                   ├─ tool-gateway（L0-L3 + canonical args）
                                   ├─ approval（参数指纹/操作者/过期/严格 JSON）
                                   ├─ 护栏（注入残留 / 敏感信息脱敏）
                                   └─ 交付：直接发送 / 草稿卡片 / 转交卡片
scheduler：日报（每日 09:00）· 审批超时清理 · 日程提醒 · 孤儿任务恢复
push：internal.pushCard 成功后的唯一推送入口（Expo Push）
```

- **权威分离**：只有主人本人的直接消息是 `owner_direct`；群成员、其他分身、工具结果、记忆都是数据。
- **审批即数据**：审批行绑定 canonical args 指纹；执行只认落库参数；修改后批准重新校验并重算指纹。
- **回合级撤权**：冻结、静默、临时档到期、任务被接管后，后续模型调用/工具执行/发送立即中止。
- **有界上下文**：历史按字符预算装载，单条截断并写入 `task_step` 可回放。
- **合理沉默**：群聊自动档、未被 @、低置信度时不回复，并记录「已评估未响应」。
- **档位合并**：会话档位优先；contact / schedule / global 策略作为兜底并叠加约束。
- **让位与接管**：主人在该会话在线且正在输入时自动暂停；一键「接管」取消任务并冷却 15 分钟。
- **不确定即转人**：资金/法律场景直接转交；auto 档置信度 < 0.7 自动转草稿。
- **记忆**：按对话对象隔离，敏感记忆不用于对外对话；「纠正」会写入偏好记忆。
- **审计**：`audit_log` 追加式 + 哈希链；关键入口统一脱敏错误。
- **会话延续（P1）**：`ai/src/engagement.ts` 基于最近 10 分钟消息推导「回复链 / 同发送者窗口」，
  路由新增 `reply` / `continuation` 触发来源；最多 5 次分身回复，其他真人插话或 @ 他人即结束；
  纯寒暄（“好的”“嗯”等）不延续。
- **工作态信号**：`agent-runtime` 在任务开始/结束时调用内部接口 `/internal/v1/typing`，
  客户端据此把发送按钮切换为停止/接管（Web `chat-input`、Mobile `chat/[id]`）。
- **好友申请**：`core/crates/chat/src/friend.rs`；接受后在同一事务写入双向 `contact`；
  反向申请自动合并；WS `friend_requests_changed` 驱动客户端刷新。
- **群主转让 / 解散**：`conversation::transfer_owner` / `dissolve_group`；仅群主可操作，
  解散级联删除会话、消息、成员与接待投影。
- **接待权（Delegation / Reception）**：`core/crates/chat/src/reception.rs` 解析
  全局/分组/联系人/会话四级委托，写 `conversation_reception` 投影与版本号；
  `message::send_message` 在事务内做版本围栏，旧 AI 回合在接管后会被拒绝。
  对端请求真人由 `human_request` 表限流，主人批准走卡片动作同步切换。
- **交接摘要与冷启动**：`ai/src/reception.ts` 生成 `reception_digest`；`avatar.trust_level`
  控制 L0 观察 / L1 草稿 / L2 低风险自动 / L3 全权。
- **归属隔离**：控制台按登录用户取自己的 avatar（不接受 avatarId 入参）；资源按 `avatar_id/owner_id`
  过滤；卡片操作校验任务归属（详见 [system-design.md §26.4](system-design.md#264-权限与隔离)）。
- **日程提醒**：`calendar_reminder` 台账（`avatarId + entryId + startAt` 唯一键），提前 10 分钟推送，
  超过 15 分钟时效线记 `missed`。
- 数据库统一使用 **Drizzle ORM**：AI 表可写、core 表只读（outbox 除外），复杂 SQL 用 `sql` 模板表达。

## 5. 端云一体

客户端（Web / Tauri / Expo）与云端共享同一个 Agent 身份、事实、授权和任务生命周期：

- **消息幂等**：`Message.clientMsgId` 透出，客户端用它精确对账乐观消息；
- **离线队列**：`CommandOutbox` 持久化，鉴权成功 / 恢复联网 / 回前台自动重放，服务端幂等；
- **设备能力**：鉴权时上报平台、版本与能力位，写入 `device` 表，内部接口可查；
- **服务端 epoch**：`auth_ok.serverEpoch` 变化时重置投影并拉快照，离线队列保留；
- **多端一致**：所有客户端共享 seq / WS 补洞 / 同一套事件折叠逻辑；
- **推送**：移动端注册 ExpoPushToken，服务端在 `pushCard` 后统一推送四类卡片；
- **主题与地址**：主题偏好本地持久化；服务地址构建期固定，仅开发构建暴露切换入口。

完整设计见 [client-cloud.md](client-cloud.md)。

## 6. 客户端

- **Web**：Vite 8 + React 19 + Tailwind v4 + @base-ui/react 手写组件（`apps/web/src/components/ui`）。
  - 服务地址：生产构建期固定（`VITE_SERVER_URL` / `VITE_ADMIN_URL`），未配置时走同源反代
    （`/api`、`/ws`、`/admin`）；仅 `DEV` 构建显示临时「服务器设置」。
- **Desktop**：Tauri 2 直接复用 `apps/web`，无重复前端代码。
- **命令面板**：`apps/web/src/components/layout/command-palette.tsx`，`⌘K` 全局入口。
- **Mobile**：Expo SDK 58 + expo-router，复用 `packages/shared`。
  - 信息架构：5 tab（消息 / 审批 / 日程 / 分身 / 我的）；联系人、日报为「我的」二级页。
  - 设计系统：`apps/mobile/src/ui`（原语 + 主题），规范见 [ui-guidelines.md §9](ui-guidelines.md#9-移动端设计系统appsmobilesrccui)。
  - 服务地址：`EXPO_PUBLIC_SERVER_URL` / `EXPO_PUBLIC_ADMIN_URL` 构建期注入；`__DEV__` 才显示切换入口。
  - 开发调试：iOS 模拟器默认 `http://127.0.0.1:7100`；Android 模拟器需在开发构建的「服务器设置」中手动填写 `http://10.0.2.2:7100`（代码不会自动切换）。

## 7. 工程约定

- **Schema 所有权**：消息/会话/成员/设备归 Rust；策略/任务/记忆/审计/能力/审批/推送台账归 Bun；
  双方互不越界写表。
- **契约只加不改**：字段只加不改，新类型只增分支，未知类型降级为文本。
- **配置归属**：服务地址、密钥等部署配置不进入用户界面；开发调试入口仅 `__DEV__`。
- **迁移**：core 迁移编译期嵌入二进制；AI 迁移随产物发布、部署时先迁移后重启。
- **测试分层**：契约 fixtures 往返、shared 状态机、AI 单元/恢复集成、Rust 工具与契约测试
  （详见 README「测试」）。
