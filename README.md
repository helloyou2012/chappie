# Chappie · AI 分身 IM

人机同群聊天的 AI 分身 IM 系统。每个用户拥有一个代表自己的 AI 分身；分身是会话中的一等成员，
可按会话设置 **手动 / 草稿 / 自动 / 静默** 档位，在自动档下替你回复、执行工具、发起审批，
并始终遵守「默认不信任、可审计、可接管」的设计原则。

## 文档

- **[docs/system-design.md](docs/system-design.md)** — 系统设计方案
- **[docs/ui-guidelines.md](docs/ui-guidelines.md)** — UI 规范

## 架构

```
┌───────────── 客户端 ─────────────┐
│ Web(React+Vite)  Desktop(Tauri)  │
│ Mobile(React Native / Expo)      │
└────────────────┬─────────────────┘
          WebSocket / HTTPS
┌────────────────▼───────────────────────────────┐
│ im-core（Rust）：网关 · 会话 · seq · outbox      │
│   gateway / chat / internal-api / store / common │
├──────────────────────────────────────────────────┤
│ PostgreSQL（事实来源）  Redis（加速层，全 TTL）   │
├──────────────────────────────────────────────────┤
│ ai-platform（Bun）：router → policy → classifier  │
│   → agent-runtime → tool-gateway → memory        │
│   model-gateway · approval · scheduler ·         │
│   admin-api（用户控制台）                         │
└──────────────────────────────────────────────────┘
```

## 目录结构

```
chappie/
├── packages/
│   ├── contract/   # 契约唯一真相（zod）：实体 / WS 帧 / REST DTO / 事件 / AI 数据
│   └── shared/     # 三端复用：API 客户端、WS 客户端、zustand 状态
├── core/           # Rust im-core（cargo workspace）
│   ├── migrations/ # core 表（sqlx migrate，启动自动执行）
│   └── crates/{common,store,chat,internal-api,gateway,im-core}
├── ai/             # Bun ai-platform（源码直跑）
│   ├── migrations/ # AI 表（bun src/migrate.ts）
│   └── src/        # router / policy / classifier / agent-runtime / tool-gateway /
│                   # memory / model-gateway / approval / scheduler / admin-api 等
├── apps/
│   ├── web/        # React 19 + Vite 8 + Tailwind v4 + @base-ui/react
│   ├── desktop/    # Tauri 2（直接复用 apps/web 前端）
│   └── mobile/     # Expo SDK 58 + expo-router（复用 packages/shared）
├── deploy/docker-compose.yml   # PostgreSQL 18 + Redis 8
└── docs/                       # 设计与 UI 文档
```

## 快速开始

### 前置条件

- Node ≥ 20、pnpm ≥ 10、Bun ≥ 1.2、Rust（cargo）、Docker
- 桌面端需要 Tauri 2 环境（macOS 需 Xcode Command Line Tools）
- macOS 注意：AirPlay Receiver 默认占用 7000 端口，本项目网关使用 **7100**

### 1. 启动基础设施

```bash
pnpm compose:up        # PostgreSQL(:15432) + Redis(:6379)
cp .env.example .env   # 首次
```

### 2. 启动 im-core（Rust）

```bash
pnpm core              # 启动时自动执行 core 迁移
# 对外 http://127.0.0.1:7100  内部 http://127.0.0.1:7001（仅回环）
```

### 3. 初始化并启动 ai-platform（Bun）

```bash
pnpm install
pnpm ai:migrate        # 建 AI 表（幂等）
pnpm ai                # worker + scheduler + admin-api(:7002) 一起启动
pnpm ai:seed           # 注册能力 + 演示账号 alice/bob + 单聊/群聊
```

### 4. 打开客户端

```bash
pnpm web               # http://localhost:5173
pnpm desktop           # Tauri 窗口（复用同一前端）
pnpm mobile            # Expo Dev Server（按提示打开 iOS 模拟器/Expo Go）
```

### 演示账号

- 任意邮箱（如 `alice@demo.dev`）均可登录，开发模式验证码直接回显并自动填入。
- 另开隐私窗口用 `bob@demo.dev` 登录，即可体验两个真人 + 两个分身同群聊天、跨用户 @ 分身。
- 验证码限流为每邮箱每小时 5 次，超限执行：
  `docker exec chappie-redis redis-cli DEL 'core:rl:code:alice@demo.dev'`

## 功能一览

- **分身会话**：侧栏「alice 的分身」是与分身的控制通道，可直接下达指令
  （如「帮我查下今天的日程安排」「帮我给 bob 转账 200 元」）。
- **档位切换**：会话顶部的 `手动 / 草稿 / 自动 / 静默`，支持「临时 2 小时」；草稿档生成可编辑的草稿卡片。
- **群聊 @**：`@` 选择对方分身，对方分身以「AI 代发」身份响应（其主人为手动档时也可被唤起）。
- **审批中心**：聚合 L2 待确认请求，超时自动拒绝。
- **分身控制台**：人设与风格预览、策略引擎、能力授权、记忆治理、用量与预算。
- **分身日报**：每日 09:00 自动生成，也可手动触发。
- **反馈闭环**：AI 消息支持点赞 / 纠正（写入偏好记忆）/ 举报。

## 配置

### 模型网关

`.env` 中配置，默认 `mock`，**无需任何 API key 即可完整演示**：

```bash
# mock | openai-chat | openai-responses | anthropic
MODEL_PROVIDER=mock
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_API_KEY=
MODEL_NAME=gpt-4o-mini
```

| provider           | 协议                           | 说明                                                    |
| ------------------ | ------------------------------ | ------------------------------------------------------- |
| `openai-chat`      | POST `{base}/chat/completions` | 兼容绝大多数 OpenAI 风格网关（含自建 vLLM/Ollama 网关） |
| `openai-responses` | POST `{base}/responses`        | OpenAI Responses API（含 function_call 工具循环）       |
| `anthropic`        | POST `{base}/v1/messages`      | Anthropic Messages API（tool_use / tool_result）        |

未配置 key 或调用失败会自动降级为 mock。分类小模型可通过 `CLASSIFIER_*` 独立配置。

### 端口与环境变量

| 变量                 | 默认                                                 | 说明                                                   |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| `GATEWAY_PORT`       | 7100                                                 | im-core 对外 HTTP/WS（避开 macOS AirPlay 占用的 7000） |
| `INTERNAL_PORT`      | 7001                                                 | im-core 内部 API（仅 127.0.0.1）                       |
| `ADMIN_PORT`         | 7002                                                 | ai-platform 控制台 API                                 |
| `DATABASE_URL`       | `postgres://chappie:chappie@127.0.0.1:15432/chappie` | compose 映射到 15432，避免与本机 PG 冲突               |
| `REDIS_URL`          | `redis://127.0.0.1:6379`                             |                                                        |
| `AUTH_CODE_DEV_ECHO` | `true`                                               | 开发模式验证码回显（生产请关闭并配置 `SMTP_URL`）      |
| `MAX_HOP_COUNT`      | 3                                                    | AI 对 AI 最大跳数                                      |

## 实现要点

### 契约：无 protobuf 方案

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

### im-core（Rust）

- **单写者**：消息只由 `chat::send_message` 写入，人类 WS 与 AI 内部 API 走同一路径。
- **发送事务**：`(sender_id, client_msg_id)` 幂等 → 行锁分配 seq → 消息 + outbox 同事务。
- **分身代发强校验**：`on_behalf_of` 必须等于主人；`hop_count` 超限拒绝（防 AI 互聊死循环）。
- **WS 网关**：首帧鉴权、心跳/空闲断开、有界队列背压（客户端按 seq 补洞）。
- **fanout**：进程内 broadcast + Redis Pub/Sub；Redis 不可用时退化为单节点。
- **outbox**：`FOR UPDATE SKIP LOCKED` 由 Bun 消费，PG 咨询锁保证同会话事件有序。

### ai-platform（Bun）

```
outbox-worker ──► pipeline ──┬─► router（候选分身）
                             ├─► policy（档位/让位/冷却/限流/预算/禁区话题）
                             ├─► classifier（规则意图分类）
                             └─► agent-runtime
                                   ├─ 提示词分层装配 + 不可信数据隔离
                                   ├─ 工具循环（最多 3 轮，L2 触发审批挂起）
                                   ├─ 护栏（注入残留 / 敏感信息脱敏）
                                   └─ 交付：直接发送 / 草稿卡片 / 转交卡片
scheduler：日报（每日 09:00）· 审批超时清理
```

- **档位合并**：会话档位优先；contact / schedule / global 策略作为兜底并叠加约束。
- **让位**：主人在该会话在线且正在输入时自动暂停；一键「接管」会取消任务并冷却 15 分钟。
- **不确定即转人**：资金/法律场景直接转交；auto 档置信度 < 0.7 自动转草稿。
- **记忆**：按对话对象隔离，敏感记忆不用于对外对话；「纠正」会写入偏好记忆。
- **审计**：`audit_log` 追加式 + 哈希链。
- 数据库统一使用 **Drizzle ORM**：AI 表可写、core 表只读（outbox 除外），复杂 SQL 用 `sql` 模板表达。

### 客户端

- **Web**：Vite 8 + React 19 + Tailwind v4 + @base-ui/react 手写组件（`apps/web/src/components/ui`）。
- **Desktop**：Tauri 2 直接复用 `apps/web`，无重复前端代码。
- **Mobile**：Expo SDK 58 + expo-router，复用 `packages/shared`；Metro 已配置 monorepo。
  - iOS 模拟器默认连 `http://127.0.0.1:7100`；Android 模拟器需在登录页「服务器设置」改为 `http://10.0.2.2:7100`。

## UI 规范

一套面向「AI 分身 IM 工作台」的设计语言：macOS 暖灰玻璃质感、会话级强调色、
精确排版与四档透明度层级。完整规范见 **[docs/ui-guidelines.md](docs/ui-guidelines.md)**：

- 双层 token（Tailwind v4 `@theme inline` → CSS 变量），`.dark` 切换主题；
- 交互层级：`surface-veil → raised → hover → selected`；
- 字体：Inter 优先、14px 基准、负字距、510/590 非标准字重、数字 `tabular-nums`；
- 圆角梯度 6 / 8 / 10 / 12 / 16px（窗口 24px、胶囊 9999px）；阴影仅用于浮层；
- 分身强调色（`--agent-accent`）以 tint、角标、focus 边框小面积出现；
- 移动端 `apps/mobile/src/theme.ts` 与 Web token 同源。

## 开发

### 代码规范（Biome）

统一使用 [Biome](https://biomejs.dev) 2.x 做格式化与 lint：

```bash
pnpm format        # 格式化全部
pnpm format:check  # 仅检查格式
pnpm lint          # lint + 格式检查
pnpm lint:fix      # 应用自动修复
```

- 配置 `biome.jsonc`：2 空格缩进、单引号（JSX 属性双引号）、行宽 100、LF、import 自动排序；
- 覆盖 `packages/*`、`apps/*`、`ai/src`、`scripts` 的 TS/TSX/JS/JSON；CSS 文件整体关闭 formatter / linter；
- `.vscode/settings.json` 已配置保存时格式化与安全修复，推荐安装 `biomejs.biome` 扩展。

### 测试

```bash
pnpm lint                                                    # Biome 检查
pnpm test                                                    # 契约 + shared + AI 全部测试
pnpm test:contract                                           # 契约 fixtures / contentText
pnpm test:shared                                             # 客户端状态机 / 格式化 / WS 重连
pnpm test:ai                                                 # AI 单元 + 恢复集成测试（需 PG + pnpm ai:migrate）
pnpm test:rust                                               # Rust 纯工具 + 契约往返单测
```

测试分层：

- **契约**（`packages/contract`）：fixtures zod 校验 + 内容预览降级文案；
- **shared**（`packages/shared/test`）：聊天归约（排序/去重/未读/补拉）、格式化、存储适配、WS 首帧鉴权与重连；
- **AI**（`ai/test`）：意图分类、输出护栏、记忆抽取、mock 模型、工具网关授权/风险分级、
  策略引擎（档位/禁区/预算），以及任务断连恢复（租约围栏、检查点续跑、账本复用、
  非幂等不确定转人工、审批续跑中断不重复转账、陈旧任务丢弃）。
- **Rust**（`core`）：ID/时间工具单测 + 与 TS 共用的契约 fixtures 往返。
- AI 集成测试自带隔离夹具并在结束后清理；数据库不可用或未迁移时自动跳过。

### 生产部署（GitHub Actions）

线上环境：**https://chappie.run**。构建全部在 GitHub Actions 完成，服务器只运行产物
（不安装 Node / Rust / pnpm，也不做任何编译）。

推送 `main` 或手动触发 `workflow_dispatch` 后，`.github/workflows/deploy.yml` 会：

1. 跑契约 / shared / AI 单元测试；
2. `pnpm web:build` 构建 Web 静态产物；
3. `cargo build --release -p im-core` 构建 x86_64 Linux 二进制；
4. `bun build --target=bun` 把 ai-platform 打成自包含 bundle（`index.js` + `migrate.js`）；
5. 打包 `bin/im-core + web/ + ai/dist + ai/migrations`，通过 SSH 上传并执行
   `deploy/remote-deploy.sh`（同步产物 → 跑迁移 → 重启 systemd）。

需要在仓库 Settings 配置：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `DEPLOY_HOST` | Secret | 服务器地址（如 `13.158.45.159`） |
| `DEPLOY_SSH_KEY` | Secret | 部署用 SSH 私钥全文 |
| `DEPLOY_ENABLED` | Variable | 设为 `true` 才启用部署任务（未配置时只构建、不发布） |

服务器目录布局（`/opt/chappie`）：

```
bin/im-core          # systemd: chappie-core
web/                 # Caddy 静态根目录
ai/dist/index.js     # systemd: chappie-ai（Bun bundle，无 node_modules）
ai/dist/migrate.js   # 部署时执行 AI 迁移
ai/migrations/*.sql
.env                 # 生产配置（600，保留在服务器，不随产物覆盖）
```

Caddy 将 `/api/*`、`/ws` 反代到 `127.0.0.1:7100`，`/admin/*` 反代到 `127.0.0.1:7002`，
其余走 `web/` 的 SPA。手动回滚：在 Actions 中重跑历史 artifact，或用
`workflow_dispatch` 重新部署。

### 品牌资产

- 唯一源文件：`apps/desktop/icon-source.svg`
- `pnpm icons` 重新生成桌面图标、Expo 图标与 Web favicon（依赖本机 Chrome，
  可用 `CHROME_BIN=/path/to/chrome pnpm icons` 覆盖）
- 运行中 UI 使用内联 SVG 组件（`apps/web/src/components/ui/logo.tsx`、
  `apps/mobile/src/components/logo.tsx`），修改图形时需同步更新

## 常见问题

| 现象              | 处理                                                                            |
| ----------------- | ------------------------------------------------------------------------------- |
| 7000 端口被占用   | macOS AirPlay Receiver；本项目已用 7100                                         |
| 5432 被占用       | compose 已映射 15432；`.env` 的 `DATABASE_URL` 同步                             |
| 验证码 429        | 每邮箱每小时 5 次限流；清理 `core:rl:code:<email>`                              |
| 分身不回复        | 检查档位、让位、冷却、预算；在控制台「任务回放」查看 `agent_task` / `task_step` |
| 移动端连不上后端  | Android 模拟器用 `10.0.2.2`；真机用电脑局域网 IP 并在登录页配置                 |
| 桌面端白屏        | 需先 `pnpm web` 启动 5173（dev 模式由 Tauri 加载它）                            |
| Docker Hub 拉取慢 | 先用加速源拉取并 `docker tag` 为 `postgres:18` / `redis:8` 等默认名             |

## 工程取舍

按「依赖最少、边界清晰」原则落地，以下能力预留接口但未实现：

- **推送通道**：APNs / FCM 为 stub（device 表已登记）。
- **对象存储 / 文件消息**：类型已注册（image / file），未实现上传服务。
- **向量检索**：`memory_item.embedding` 用 `REAL[]` + 应用层余弦，无需 pgvector；接口已隔离。
- **SMTP 投递**：`EmailSender` 已抽象，SMTP 分支目前仅记录日志。
- **审批卡片刷新**：批准后的结果以新消息呈现，未回写卡片内容。
- **多租户 / RLS / DLP / 插件市场 / 多渠道网关**：未实现。
- **大规模部署**：fanout 已具备 Redis 多节点语义，未做分片扇出。
