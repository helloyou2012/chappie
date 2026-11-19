# 端云一体设计

本文说明 chappie 的客户端(Web / 桌面 / 移动)与云端(Rust im-core + Bun ai-platform)如何作为一个连续的 Agent 系统工作。

核心结论:

> **端云一体不是把同一个 Agent 复制到两端,而是让两端共享同一个 Agent 身份、同一份事实、同一套授权和同一条任务生命周期。**
>
> 云端负责「思考与执行」,客户端负责「输入、投影、审批、接管、设备能力」。云端是唯一事实源,客户端是它的投影与入口。

**目录**：职责划分 · 四条契约 · 一次完整旅程 · 四层不变量 · 弱网/离线/多端 ·
端侧能力 · 推送与通知 · 安全与审计 · 实现索引。
实现完成度、限制与路线图统一见 [status.md](status.md)。

---

## 一、职责划分

| 能力         | 云端                         | 客户端                                         |
| ------------ | ---------------------------- | ---------------------------------------------- |
| 身份与会话   | 用户、设备、token、权限      | 保存 token、设备 id、登录态                    |
| 消息事实     | 消息、seq、成员、已读、撤回  | 本地缓存、乐观消息、未读投影                   |
| Agent 运行时 | 任务、租约、检查点、工具循环 | 展示进度、取消、接管                           |
| 策略与档位   | 档位合并、让位、限流、预算   | 切换档位、临时模式                             |
| 审批         | 审批记录、参数指纹、执行     | 展示卡片、批准/修改/拒绝                       |
| 记忆         | 存储、检索、治理、敏感过滤   | 展示、编辑、删除、遗忘                         |
| 模型与工具   | provider、工具网关、沙箱     | 不持有模型密钥                                 |
| 设备能力     | 声明需要什么能力             | 提供相机、相册、文件、剪贴板、通知、定位、分享 |
| 实时事件     | 产生有序事件                 | 消费事件、补洞、渲染                           |
| 审计         | 追加式审计、任务回放         | 展示解释卡片与回放                             |

关键边界:

- 客户端**不拥有**消息、任务、审批的最终状态。
- 客户端可以乐观展示,但最终以云端事件为准。
- 客户端不能直接写消息表;分身发消息也必须经内部接口,沿用同一套校验。

---

## 二、四条契约

### 2.1 身份契约

- 云端签发用户 token;WS 首帧鉴权,10 秒超时。
- 设备与用户分离:同一用户可有多个设备,每台设备有自己的连接、能力清单、推送 token。
- 客户端只持有可撤销的用户 Bearer token(30 天);模型 key、内部 token、工具凭据永不下发。
- 审批只认主人 token(approver 校验);设备可信度/二次验证未实现,群聊里的其他成员不能代替主人批准。

### 2.2 命令契约(客户端 → 云端)

所有用户动作都是类型化命令:

| 命令             | 作用             | 幂等键              |
| ---------------- | ---------------- | ------------------- |
| `send_message`   | 发送消息         | `clientMsgId`       |
| `typing`         | 输入中           | 短 TTL              |
| `mark_read`      | 已读上报         | `(convId, seq)`     |
| `recall_message` | 撤回             | `msgId`             |
| `pull_messages`  | 按 seq 补洞      | `(convId, fromSeq)` |
| REST 控制台/审批 | 档位、审批、反馈 | 业务 id             |

- 命令只表达意图,不携带「已经完成」的结论。
- 结果由云端事件返回。
- `clientMsgId` 同时用于幂等与乐观消息对账。

### 2.3 事件契约(云端 → 客户端)

- 云端维护一条 canonical 事件流:
  - 新消息 `message_created`;
  - 发送确认 `message_acked`;
  - 撤回、卡片更新、批量补拉;
  - typing、presence、read_sync。
- 每条消息带会话内单调 `seq`;客户端按 seq 排序、去重、补洞。
- `message_acked` 与 `message_created.clientMsgId` 都可用于移除本地 pending。
- 重连时:
  - 先按本地最后 seq 拉取缺口;
  - 本地状态不可信或跨设备时,拉 REST 快照重建。

### 2.4 能力契约(Agent ↔ 端侧)

- 云端声明 Agent 需要什么能力:模型、工具、审批、记忆、文件、通知。
- 客户端声明自己有什么端侧能力:相机、相册、文件、剪贴板、定位、本地网络、分享、生物识别、通知。
- 能力清单由客户端在鉴权时上报,云端只读。
- 端侧动作通过类型化桥接调用(目标态;当前仅完成能力上报,调用桥接未实现):
  - 云端决定「要不要调用」;
  - 客户端执行「本地动作」;
  - 结果回传云端,写入同一份任务与审计。
- 端侧动作同样受权限、审批、撤权约束;不能因为「在手机上」就绕过。

---

## 三、一次完整的端云旅程

以「用户让分身给群里发一条消息,涉及转账」为例:

1. **客户端**构造 `send_message`,带 `clientMsgId`,先本地乐观展示。
2. **Rust core** 首帧鉴权后的 WS 收到命令:
   - 幂等检查 `(sender_id, client_msg_id)`;
   - 行锁分配 `seq`;
   - 写消息 + outbox;
   - 返回 `message_acked`;
   - 进程内 fanout + Redis Pub/Sub 广播给其他节点。
3. **其他客户端**收到 `message_created`,按 seq 合并;发现断洞则 `pull_messages`。
4. **Bun AI 层**消费 outbox:
   - router 找到候选分身;
   - policy 判断档位、让位、限流、预算;
   - classifier 判断是否需要回应;
   - agent-runtime 装配上下文、检索记忆、调用模型。
5. **高风险工具**触发审批:
   - 云端创建审批记录,绑定 canonical args hash;
   - 通过内部 API 推送审批卡片到主人的系统会话;
   - 客户端展示卡片,提交 `approve / modify_approve / reject`。
6. **云端校验**:
   - 操作者是否是审批人;
   - 是否过期;
   - 参数是否通过 schema 校验;
   - 指纹是否一致;
   - 任务是否仍归自己(租约);
   - 是否被冻结/静默/接管(撤权)。
7. **执行工具**,结果回写审批、任务步骤、审计。
8. 分身通过内部 API 发消息:
   - `sender = avatar`,`on_behalf_of = owner`;
   - core 强校验归属与 hop_count;
   - 分配 seq、写 outbox、广播给所有客户端。
9. **客户端**看到「AI 代发」消息、解释卡片、任务进度;可随时撤回、纠正、接管。
10. **多端**同时在线时,所有端看到同一 seq 序列;某端离线,重连后补洞或拉快照。

---

## 四、保障机制:四层不变量

### 4.1 不丢:outbox + seq + 重放

- 消息与 outbox 在**同一事务**写入。
- 事件先落库,再广播;广播丢了,客户端按 seq 补拉。
- 客户端断线重连,指数退避;WS 心跳 25s,服务端 60s 空闲断开。
- 本地缓存 + REST 快照双轨;快照负责重建,增量负责实时。
- 移动端回到前台时重连或重放离线队列。

### 4.2 不重:幂等键 + 唯一约束 + 效果键

- 客户端命令:`clientMsgId`。
- 消息唯一键:`(sender_id, client_msg_id)`。
- 任务唯一键:`(trigger_msg_id, avatar_id)`。
- 工具效果键:`task_id + tool + canonical(args)`;非幂等工具先写意图标记,再执行,再写完成记录。
- 审批指纹:canonical args hash;执行只认落库参数。

### 4.3 不乱:单写者 + seq + 条件更新

- 只有 Rust core 写消息表、分配 seq。
- AI 层只写 AI 表,发消息必须走内部 API。
- 任务状态迁移用条件更新,0 行即让位。
- 租约 + 心跳 + `locked_by` 围栏,防止僵尸 worker 写回。
- 客户端不按本地时间排序,只按 seq。

### 4.4 不失控:权威 + 审批 + 撤权 + 能力

- 只有主人本人的直接消息是 `owner_direct`;群成员、其他分身、工具结果都是数据。
- 审批只认审批人;群成员和 AI 不能代替主人批准。
- 回合级撤权:冻结、静默、临时档到期、任务被接管后,后续工具与发送立即中止。
- 能力默认拒绝,授权显式到「分身 × 能力 × 约束」。
- 高风险动作 L2/L3,永远不因「自动档」降级。

---

## 五、弱网、离线与多端

### 5.1 弱网

- 乐观消息立即上屏,`clientMsgId` 对账;ack 或广播到达后移除 pending。
- seq 断洞自动补拉;补拉失败进入重连退避。
- 服务端返回 `serverTime`,客户端不依赖本地时钟。
- 发送队列有上限;超限断开,让客户端重连补洞,避免拖垮节点。

### 5.2 离线

- 客户端有持久化命令队列(按用户 scope 隔离):
  - 发送消息先入队并落本地存储;
  - WS 在线时立即 flush;
  - 鉴权成功、浏览器恢复联网、移动端回到前台时自动重放;
  - 服务端用 `clientMsgId` 幂等,重复重放不会产生重复消息;
  - ack 或带相同 `clientMsgId` 的消息到达后,从队列移除。
- 高风险操作不能在离线时执行;恢复后重新走审批。
- 云端任务继续执行;客户端恢复后拉取结果与进度。

### 5.3 多端

- 同一用户多连接,按设备维护连接;fanout 推给所有在线连接。
- 已读按成员维度同步;输入状态由 Redis presence/typing 表达。按设备的已读位点尚未实现。
- 分身状态(工作中/等待审批/离线)由云端折叠事件得出,客户端只展示。
- 同一任务只能有一个执行者(租约);其他端只能观察、审批、接管。

### 5.4 服务端重启

- WS 鉴权返回 `serverEpoch`。
- 客户端记录 epoch;变化时说明服务端进程重启。
- 客户端重置本地消息投影并重新拉会话快照;离线命令队列保留,继续可重放。
- seq 仍由数据库分配,不会因为重启回退。
- 多节点部署必须给所有 im-core 设置同一个 `SERVER_EPOCH`;否则客户端在节点间重连会被误判为重启,导致反复重置投影。

---

## 六、端侧能力与云端 Agent

「端云一体」不等于模型必须在两端运行。模型可以在云端,端侧提供**能力与入口**:

- 云端 Agent 决定做什么;
- 客户端提供端侧动作:拍照、选文件、读剪贴板、发本地通知、访问局域网设备;
- 端侧动作也走同一条任务/审批/审计管线;
- 敏感数据不出端:
  - 只上传结果摘要或用户确认后的内容;
  - 模型密钥、内部 token 永不下发;
  - 推送只带摘要,不带完整消息正文。

能力清单字段:

```text
notifications  可以接收本地通知
camera         可以拍照/录像
photoLibrary   可以访问相册
files          可以选择/读写文件
clipboard      可以读写剪贴板
location       可以获取地理位置
localNetwork   可以访问局域网设备
share          可以调用系统分享
biometrics     可以使用生物识别
```

探测原则:

- 只声明当前 API 确实存在的能力;
- 通知默认按未授权处理,拿到权限后再上报;
- 拿不准的能力填 false,宁可让云端少做,也不要现场失败。

如果未来要做「端侧小模型」:

- 端侧模型只处理隐私敏感、低延迟任务;
- 云端仍是事实源与编排者;
- 端侧结果以「工具结果」身份回传,标注来源与可信级别;
- 端侧模型不能绕过审批与权限。

---

## 七、推送与通知

- 设备注册接口保存 `pushToken`(APNs / FCM / Expo 等)。
- 通知的**事实来源**仍是云端事件;推送只是提醒通道。
- 推送内容最小化:
  - 只带 kind、标题、会话/任务 id;
  - 不带完整消息正文;
  - 点击后回到具体会话或任务。
- 抑制规则:
  - 在线用户(WS 可实时收到) → 不推送;
  - 没有需要提醒的卡片 → 不推送;
  - 会话级可见性判断、静默时段与频率上限尚未实现。
- 当前状态:移动端已通过 `expo-notifications` 注册 Expo Push token;推送前查询 presence,在线不推;
  APNs/FCM 由 Expo 代发,需配置 `EXPO_ACCESS_TOKEN`;Web/Desktop 无推送通道。

---

## 八、安全与审计

- 传输:TLS;WS 首帧鉴权。
- 令牌:用户 Bearer token 30 天有效、可撤销;内部接口使用独立 `X-Internal-Token`(仅回环监听)。
- 审批:
  - 审批人显式校验;
  - 参数 canonical hash;
  - 一次性状态迁移 + 参数指纹 + 租约,不重复执行;
  - 结果未知不自动重试。
- 数据:
  - 敏感列应用层加密未实现(如需再加);
  - 推送只带标题与业务 id,不带正文/工具参数;
  - 日志、任务错误、审计写入前做凭据模式脱敏与截断。
- 审计:
  - `trace_id` 目标贯穿 客户端 → 网关 → 核心 → outbox → AI → 工具;当前 outbox 写入的 trace_id 为空,链路不完整;
  - 关键动作追加式记录;
  - 任务步骤可回放。

---

## 九、当前实现对照

| 机制                                    | 实现位置                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| WS 首帧鉴权、心跳、有界发送队列         | `core/crates/gateway/src/ws.rs`                                                                         |
| 客户端重连、seq 补洞、离线队列重放      | `packages/shared/src/ws.ts`                                                                             |
| 乐观消息、去重、断洞补拉、pending 对账  | `packages/shared/src/store/chat.ts`                                                                     |
| 离线命令队列(按用户隔离、持久化)        | `packages/shared/src/outbox.ts`                                                                         |
| 设备 id、浏览器能力探测、移动端默认能力 | `packages/shared/src/device.ts`                                                                         |
| 设备能力契约                            | `packages/contract/src/device.ts`                                                                       |
| WS/REST 设备注册与能力上报              | `core/crates/gateway/src/ws.rs`、`core/crates/gateway/src/rest.rs`、`core/crates/chat/src/auth.rs`      |
| 设备能力查询(内部接口)                  | `core/crates/internal-api/src/lib.rs`、`ai/src/common/internal.ts`                                      |
| 服务端 epoch                            | `core/crates/chat/src/state.rs`、`core/crates/gateway/src/ws.rs`、`packages/shared/src/ws.ts`           |
| 移动端前台恢复                          | `apps/mobile/app/_layout.tsx`、`apps/mobile/src/realtime.ts`                                            |
| 移动端推送令牌注册                      | `apps/mobile/src/push.ts`、`core/crates/gateway/src/rest.rs`（`/api/v1/devices`）                       |
| 已登录设备查询（多端在线条）            | `GET /api/v1/devices`、`core/crates/chat/src/auth.rs`、Web/Mobile 会话页                                |
| 会话列表派生信息                        | 服务端返回 `lastMsgSenderName`（群聊预览）；`avatar_self` 会话固定置顶                                  |
| 服务端离线推送（唯一入口）              | `ai/src/common/push.ts`（挂在 `internal.pushCard` 之后）、`ai/src/common/config.ts`                     |
| 分身工作态（typing 广播）               | `ai/src/agent-runtime.ts`、`core/crates/internal-api/src/lib.rs`（`/internal/v1/typing`）、客户端输入区 |
| 构建期服务地址                          | `apps/mobile/src/config.ts`、`apps/web/src/main.tsx`、`packages/shared/src/store/auth.ts`               |
| 主题偏好持久化                          | `apps/mobile/src/store/theme.ts`、`apps/mobile/src/hooks/use-theme.ts`                                  |
| 桌面端平台识别                          | `apps/web/src/components/layout/app-shell.tsx`（`__TAURI_INTERNALS__`）                                 |
| 消息幂等键透出                          | `packages/contract/src/chat.ts`、`core/crates/chat/src/model.rs`、`core/crates/chat/src/message.rs`     |
| 单写者消息 + seq + outbox               | `core/crates/chat/src/message.rs`                                                                       |
| AI 旁路消费 + 租约 + 恢复               | `ai/src/outbox-worker.ts`、`ai/src/common/task-lease.ts`、`ai/src/recovery.ts`                          |
| 审批指纹、操作者、撤权                  | `ai/src/approval.ts`、`ai/src/agent-runtime.ts`、`ai/src/turn-guard.ts`                                 |
| 契约唯一真相 + fixtures                 | `packages/contract`                                                                                     |

---

## 十、实现状态与限制

端云相关能力的完成度、已知限制与后续计划统一维护在 [status.md](status.md)：

- 能力矩阵：见 [status.md §1.4 端云与多端](status.md#14-端云与多端)
- 已知限制：见 [status.md §3.2 端侧与通知](status.md#32-端侧与通知)
- 检查清单：见 [status.md §5 端云一体检查清单](status.md#5-端云一体检查清单)
