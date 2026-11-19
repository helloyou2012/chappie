# Chappie · AI 分身 IM

人机同群聊天的 AI 分身 IM 系统。每个用户拥有一个代表自己的 AI 分身；分身是会话中的一等成员，
可按会话设置 **手动 / 草稿 / 自动 / 静默** 档位，在自动档下替你回复、执行工具、发起审批，
并始终遵守「默认不信任、可审计、可接管」的设计原则。

## 文档

完整文档入口与阅读路径见 **[docs/README.md](docs/README.md)**。

| 文档                                             | 一句话说明                                     |
| ------------------------------------------------ | ---------------------------------------------- |
| [docs/system-design.md](docs/system-design.md)   | 目标态架构设计                                 |
| [docs/design-essence.md](docs/design-essence.md) | 设计纪律与反模式                               |
| [docs/client-cloud.md](docs/client-cloud.md)     | 端云一体（同步 / 离线 / 推送）                 |
| [docs/ui-guidelines.md](docs/ui-guidelines.md)   | UI 规范（Web + Mobile）                        |
| [docs/implementation.md](docs/implementation.md) | 实现要点与代码地图                             |
| [docs/status.md](docs/status.md)                 | **能力矩阵 / 已知限制 / 路线图（唯一事实源）** |

## 目录

- [架构](#架构) · [快速开始](#快速开始) · [功能一览](#功能一览) · [配置](#配置)
- [开发](#开发) · [生产部署](#生产部署github-actions) · [常见问题](#常见问题)

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
│   └── shared/     # 三端复用：API/WS 客户端、zustand 状态、离线队列、设备能力、头像色板
├── core/           # Rust im-core（cargo workspace）
│   ├── migrations/ # core 表（sqlx migrate，启动自动执行）
│   └── crates/{common,store,chat,internal-api,gateway,im-core}
├── ai/             # Bun ai-platform（源码直跑）
│   ├── migrations/ # AI 表（bun src/migrate.ts）
│   └── src/        # router / policy / classifier / agent-runtime / tool-gateway /
│                   # trust / prompt / turn-guard / silence / memory / model-gateway /
│                   # approval / recovery / scheduler / admin-api 等
├── apps/
│   ├── web/        # React 19 + Vite 8 + Tailwind v4 + @base-ui/react
│   ├── desktop/    # Tauri 2（复用 apps/web；macOS 圆角图标、原生标题栏拖拽）
│   └── mobile/     # Expo SDK 58 + expo-router（复用 packages/shared）
│                   #   src/ui = 设计系统原语；src/push.ts = Expo Push；src/config.ts = 构建期地址
├── deploy/docker-compose.yml   # PostgreSQL 18 + Redis 8
└── docs/                       # 系统设计 / 设计精髓 / 端云一体 / UI 规范
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
# 本机访问 http://127.0.0.1:7100（网关绑定 0.0.0.0）  内部 http://127.0.0.1:7001（仅回环）
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

- **分身会话**：「我的分身」系统会话固定置顶（Web / Mobile），是与分身的控制通道，
  可直接下达指令（如「帮我查下今天的日程安排」「帮我给 bob 转账 200 元」）。
- **工作态与接管**：分身处理消息时广播「正在处理」，输入区发送按钮切换为「停止/接管」；
  阅读历史时不会被新消息强制拉回底部，移动端可按「回到最新」跳回。
- **命令面板（Web）**：`⌘K / Ctrl+K` 搜索会话与联系人、跳转页面、切换主题。
- **会话列表细节**：未读红点 + 数字角标（tab 同步）、静默档图标、群聊预览带发送者
  （「昵称: …」）、多端在线条（如「桌面端已登录」）。
- **档位切换**：会话顶部的 `手动 / 草稿 / 自动 / 静默`，支持「临时 2 小时」；草稿档生成可编辑的草稿卡片。
- **群聊 @**：`@` 选择对方分身，对方分身以「AI 代发」身份响应（其主人为手动档时也可被唤起）；
  群里 `@` 自己的分身 = 显式委托，分身以你的名义在该群回答（静默档除外；该能力仅在群聊生效）。
  被 @ 后 10 分钟内、同一发送者的后续消息会继续由该分身接话（最多 5 次，其他真人插话即结束）；
  直接「回复」分身的消息同样会触发，无需再次 @。
- **审批中心**：聚合 L2 待确认请求，超时自动拒绝。
- **分身控制台**：人设与风格预览、策略引擎、能力授权、记忆治理、用量与预算。
- **分身日报**：每日 09:00 自动生成，也可手动触发。
- **反馈闭环**：AI 消息支持点赞 / 纠正（写入偏好记忆）/ 举报。
- **离线与多端**：断线时消息进入持久队列，重连 / 恢复联网 / 移动端回前台自动重放；
  多端共享 seq，服务端 epoch 变化时自动重建本地投影。
- **联系人**：独立联系人页（Web 侧栏 / 移动端「我的」进入）：按邮箱添加（幂等、需对方已注册）、
  搜索、备注名（`PATCH /api/v1/contacts/:peerId`）、移除、发起单聊；
  可就单个联系人设定分身档位（复用 `scopeType=contact` 策略）；新建会话/群聊从联系人中选择，
  不再暴露全站用户目录。
- **群成员管理**：群主可添加成员（对方与分身一同入群）、移除成员；成员可自行退群。
- **推送通知**：移动端注册 Expo Push；分身审批、转交、日程提醒、日报在主人离线时推送触达
  （配置 `EXPO_ACCESS_TOKEN` 启用；在线用户走 WS，不重复推送；通知只带标题与业务 id）。
- **日程提醒**：分身按日程时间主动提醒（提前 10 分钟），发生台账去重、过期不打扰。
- **日程与待办页**：Web 提供迷你月历 + 日 / 周 / 月日历视图、搜索与当前时间红线；
  Mobile 提供今日时间轴与日程/待办列表；两端都可直接新建日程/待办（与分身工具写同一份数据）。
- **端侧能力**：客户端在 WS 鉴权时上报设备能力（相机 / 相册 / 文件 / 剪贴板 / 定位 / 通知等），
  服务端可查询，为后续端侧动作桥接预留。
- **移动端对齐**：5 个 tab（消息 / 审批 / 日程 / 分身 / 我的），功能与 Web 对齐、界面按平台优化；
  独立设计系统 `apps/mobile/src/ui`（见 UI 规范 §9），支持跟随系统 / 浅色 / 深色主题。
- **桌面端**：Tauri 复用 Web 前端，支持 macOS 圆角图标、原生标题栏拖拽与平台识别。

完整能力矩阵、已知限制与路线图见 **[docs/status.md](docs/status.md)**。

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

未配置 key 或调用失败会自动降级为 mock。分类小模型预留了 `CLASSIFIER_*` 配置项，当前分类仍为规则实现。

### 端口与环境变量

| 变量                        | 默认                                                 | 说明                                                    |
| --------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| `GATEWAY_PORT`              | 7100                                                 | im-core 对外 HTTP/WS（避开 macOS AirPlay 占用的 7000）  |
| `INTERNAL_PORT`             | 7001                                                 | im-core 内部 API（仅 127.0.0.1）                        |
| `ADMIN_PORT`                | 7002                                                 | ai-platform 控制台 API                                  |
| `DATABASE_URL`              | `postgres://chappie:chappie@127.0.0.1:15432/chappie` | compose 映射到 15432，避免与本机 PG 冲突                |
| `REDIS_URL`                 | `redis://127.0.0.1:6379`                             |                                                         |
| `AUTH_CODE_DEV_ECHO`        | `true`                                               | 开发模式验证码回显（生产请关闭并配置 `RESEND_API_KEY`） |
| `RESEND_API_KEY`            | 空                                                   | Resend API key；配置后验证码通过邮件发送                |
| `MAIL_FROM`                 | `Chappie <no-reply@chappie.run>`                     | 示例值；未配置时兜底为 Resend 测试发件人，域名需验证    |
| `MAX_HOP_COUNT`             | 3                                                    | AI 对 AI 最大跳数                                       |
| `SERVER_EPOCH`              | 空                                                   | 多节点部署必须统一；客户端据此判断服务端重启            |
| `AI_CONTEXT_CHAR_BUDGET`    | 6000                                                 | 提示词历史区字符预算（有界上下文）                      |
| `AI_SILENCE_MIN_CONFIDENCE` | 0.6                                                  | 群聊自动档低置信度沉默阈值，0 = 关闭                    |
| `EXPO_ACCESS_TOKEN`         | 空                                                   | Expo Push access token；配置后移动端离线推送生效        |
| `EXPO_PUSH_URL`             | `https://exp.host/--/api/v2/push/send`               | 自建/代理推送服务地址                                   |

客户端构建期配置（不进入 `.env` 根文件）：

| 端         | 变量                                    | 说明                                                                |
| ---------- | --------------------------------------- | ------------------------------------------------------------------- |
| Web / 桌面 | `VITE_SERVER_URL` / `VITE_ADMIN_URL`    | Vite 构建期注入；留空走同源反代（见 `apps/web/.env.example`）       |
| 移动端     | `EXPO_PUBLIC_SERVER_URL` / `_ADMIN_URL` | Expo 构建期注入；留空回退同源/本机（见 `apps/mobile/.env.example`） |

## 技术实现

代码结构与关键机制（契约方案、im-core、ai-platform、端云、客户端）见
**[docs/implementation.md](docs/implementation.md)**；目标态架构见
**[docs/system-design.md](docs/system-design.md)**。

## UI 规范

一套面向「AI 分身 IM 工作台」的设计语言：macOS 暖灰玻璃质感、会话级强调色、
精确排版与四档透明度层级。完整规范见 **[docs/ui-guidelines.md](docs/ui-guidelines.md)**。

- 双层 token（Tailwind v4 `@theme inline` → CSS 变量），`.dark` 切换主题；
  移动端 `apps/mobile/src/theme.ts` 与 Web 同源。
- 交互层级：`surface-veil → raised → hover → selected`；1px 发丝线只用于板块边界。
- 聊天页三栏单卡（272 / 自适应 / 300），栏宽可拖拽持久化；移动端为 5 tab + 二级页。
- 控件高度对齐：Input / Select / Button 默认 32px、sm 28px；移动端 44 / 34。
- 移动端原语统一收敛在 `apps/mobile/src/ui`（Text/Card/Button/Sheet/ListRow 等），
  业务页面不直接写裸 `Text`/样式，详见规范 §9。

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
- **shared**（`packages/shared/test`）：聊天归约（排序/去重/未读/补拉）、格式化、存储适配、
  WS 首帧鉴权与重连、离线队列持久化/重放、pending 精确对账、头像首字母取色；
- **AI**（`ai/test`）：意图分类与置信度、输出护栏、记忆抽取、mock 模型、工具网关授权/风险分级、
  策略引擎（档位/禁区/预算）、权威分区、提示词预算、合理沉默、回合撤权、
  审批参数指纹/操作者/过期/严格 JSON，任务断连恢复（租约围栏、检查点续跑、账本复用、
  非幂等不确定转人工、审批续跑中断不重复转账、陈旧任务丢弃），以及推送文案映射与
  日程提醒时机判定（等待 / 触发 / 时效线丢弃）。
- **Rust**（`core`）：ID/时间工具单测 + 与 TS 共用的契约 fixtures 往返。
- AI 集成测试自带隔离夹具并在结束后清理；数据库不可用或未迁移时自动跳过。

### 生产部署（GitHub Actions）

线上环境：**https://chappie.run**。构建全部在 GitHub Actions 完成，服务器只运行产物
（不安装 Node / Rust / pnpm，也不做任何编译；需预装 Bun，部署脚本默认使用
`/home/ubuntu/.bun/bin/bun` 执行迁移）。

推送 `main` 或手动触发 `workflow_dispatch` 后，`.github/workflows/deploy.yml` 会：

1. 跑契约 / shared / AI 单元测试，并执行移动端 `tsc --noEmit`（移动端不参与部署产物）；
2. `pnpm web:build` 构建 Web 静态产物（可选注入 `VITE_SERVER_URL` / `VITE_ADMIN_URL`）；
3. `cargo build --release --manifest-path core/Cargo.toml -p im-core` 构建 x86_64 Linux 二进制；
4. `bun build --target=bun` 把 ai-platform 打成自包含 bundle（`index.js` + `migrate.js`）；
5. 打包 `bin/im-core + web/ + ai/dist + ai/migrations`，通过 SSH 上传并执行
   `deploy/remote-deploy.sh`（同步产物 → 跑迁移 → 重启 systemd）。

需要在仓库 Settings → Environments → `deploy`（或仓库级）配置：

| 名称              | 类型     | 说明                                                               |
| ----------------- | -------- | ------------------------------------------------------------------ |
| `DEPLOY_HOST`     | Variable | 服务器地址（如 `<deploy-host>`），工作流以 `vars.DEPLOY_HOST` 引用 |
| `DEPLOY_SSH_KEY`  | Secret   | 部署用 SSH 私钥全文                                                |
| `VITE_SERVER_URL` | Variable | 可选。Web 构建期网关地址；chappie.run 走同源反代，留空即可         |
| `VITE_ADMIN_URL`  | Variable | 可选。Web 构建期控制台地址；同上留空即可                           |

注意：environment 级 secrets/variables 要到 job 启动后才解析，不能在 job 级 `if`
中引用；工作流已改为 step 级引用，并在预检步骤对缺失给出明确报错。
CI 额外执行移动端 `tsc --noEmit`（移动端不打进部署产物，仅防回归）。

服务器 `.env`（不随产物覆盖）需按需补充：`EXPO_ACCESS_TOKEN`（开启离线推送）、
`RESEND_API_KEY`（真实发信码）、`INTERNAL_TOKEN`（务必修改）等，见根目录 `.env.example`。

服务器目录布局（`/opt/chappie`）：

```
bin/im-core          # systemd: chappie-core
web/                 # Caddy 静态根目录
ai/dist/index.js     # systemd: chappie-ai（Bun bundle，无 node_modules）
ai/dist/migrate.js   # 部署时执行 AI 迁移
ai/migrations/*.sql
.env                 # 生产配置（600，保留在服务器，不随产物覆盖）
```

Caddy 与 systemd 单元在服务器侧维护（不在仓库内）：Caddy 将 `/api/*`、`/ws` 反代到
`127.0.0.1:7100`，`/admin/*` 反代到 `127.0.0.1:7002`，其余走 `web/` 的 SPA。
手动回滚：在 Actions 中重跑历史 artifact（默认保留 14 天），或用 `workflow_dispatch` 重新部署。

### 品牌资产

- 唯一源文件：`apps/desktop/icon-source.svg`
- `pnpm icons` 重新生成桌面图标（macOS 824×824 圆角安全区）、Expo 图标（满幅方图，
  由系统遮罩）与 Web favicon（依赖本机 Chrome，可用 `CHROME_BIN=/path/to/chrome pnpm icons` 覆盖）
- 运行中 UI 使用内联 SVG 组件（`apps/web/src/components/ui/logo.tsx`、
  `apps/mobile/src/components/logo.tsx`），修改图形时需同步更新

## 常见问题

| 现象              | 处理                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 7000 端口被占用   | macOS AirPlay Receiver；本项目已用 7100                                                                                      |
| 5432 被占用       | compose 已映射 15432；`.env` 的 `DATABASE_URL` 同步                                                                          |
| 验证码 429        | 每邮箱每小时 5 次限流；清理 `core:rl:code:<email>`                                                                           |
| 分身不回复        | 检查档位、让位、冷却、预算；通过 `GET /admin/v1/tasks` / `/tasks/:id` 查看 `agent_task` / `task_step`                        |
| 移动端连不上后端  | 开发构建：登录页「服务器设置」填 `10.0.2.2`（Android 模拟器）或电脑局域网 IP；生产构建：改 `EXPO_PUBLIC_SERVER_URL` 重新打包 |
| 桌面端白屏        | 需先 `pnpm web` 启动 5173（dev 模式由 Tauri 加载它）                                                                         |
| Docker Hub 拉取慢 | 先用加速源拉取并 `docker tag` 为 `postgres:18` / `redis:8` 等默认名                                                          |

## 工程取舍

按「依赖最少、边界清晰」原则落地；推送、附件、端侧动作、多租户等能力的当前状态、
限制原因与后续计划统一维护在 **[docs/status.md](docs/status.md)** 的「能力矩阵 / 已知限制 / 路线图」。
