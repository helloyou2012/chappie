# Chappie 文档

本目录是项目文档的唯一入口。每份文档只回答一类问题，避免重复维护。

## 文档地图

| 文档                                   | 回答的问题                                                       | 不包含                            |
| -------------------------------------- | ---------------------------------------------------------------- | --------------------------------- |
| [../README.md](../README.md)           | 这是什么产品？怎么跑起来？有哪些功能？怎么部署与排错？           | 深层设计论证                      |
| [system-design.md](system-design.md)   | **目标态架构**：领域模型、协议、数据模型、运行时、安全、演进     | 当前完成度（见 status）           |
| [design-essence.md](design-essence.md) | **设计纪律**：信任、审批、执行恢复、上下文、群聊、记忆、反模式   | 具体代码位置（见 implementation） |
| [client-cloud.md](client-cloud.md)     | **端云一体**：命令/事件/能力契约、离线、多端、推送、安全         | 功能清单（见 status）             |
| [reception.md](reception.md)           | **接待权**：权威/策略、作用域、切换协议、接口与安全底线          | 当前完成度（见 status）           |
| [ui-guidelines.md](ui-guidelines.md)   | **UI 规范**：色彩/排版/间距/组件规格，Web 与移动端设计系统       | 业务功能                          |
| [implementation.md](implementation.md) | **实现要点**：代码地图、契约方案、核心/ai/客户端关键机制         | 目标态设计与路线图                |
| [status.md](status.md)                 | **唯一事实来源**：能力矩阵、实现位置、已知限制、路线图、检查清单 | 设计原理                          |

## 状态标记

设计文档描述目标态；当前完成度统一见 [status.md](status.md)。

| 标记 | 含义           |
| ---- | -------------- |
| ✅   | 已实现         |
| 🚧   | 部分实现       |
| ⬜   | 设计态，未实现 |

## 阅读路径

- **第一次接触项目**：README 快速开始 → 功能一览 → status 能力矩阵。
- **产品/设计**：design-essence → system-design（第 1–19 章）→ status 路线图。
- **后端**：system-design（第 20–37 章）→ implementation（核心/AI 平台）→ design-essence（审批与恢复）。
- **客户端**：implementation（客户端）→ client-cloud → ui-guidelines。
- **运维/部署**：README（生产部署、FAQ）→ status（已知限制）→ .env.example。

## 术语

| 术语          | 含义                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------- |
| 分身 / Avatar | 代表用户发言的 AI 主体，是会话的一等成员                                                       |
| 主人 / Owner  | 分身代表的真人用户；审批与授权的唯一主体                                                       |
| im-core       | Rust 消息核心（网关 / 会话 / seq / outbox）                                                    |
| ai-platform   | Bun AI 平台（路由 / 策略 / 运行时 / 工具 / 审批 / 调度）                                       |
| 契约          | TS 端以 `packages/contract` 的 zod schema 为源；Rust 通过同包导出的 `fixtures.json` 做往返校验 |
| 档位          | manual / draft / auto / off，四档分身工作模式                                                  |
| 台账          | 以唯一键去重、可回看的发生记录（如 `calendar_reminder`）                                       |

## 维护约定

1. **实现状态只写在 [status.md](status.md)**：其他文档引用它，不复制表格。
2. **契约以代码为准**：`packages/contract` 是唯一真相，文档不重复字段清单。
3. **设计文档区分时态**：目标态写在 system-design；当前实现差异单独标注并链接 status。
4. **UI 规范只写在 [ui-guidelines.md](ui-guidelines.md)**：组件新增/尺寸变化必须同步 §5 与 §9。
5. **变更文档时同步入口**：新增文档必须登记到本页文档地图。
