# @chappie/contract

契约唯一真相（替代 protobuf 方案）：以 zod schema 定义全部跨端结构 —— 实体、WS 帧、REST DTO、outbox 事件、AI 平台数据。

- **TS 侧**（web / desktop / mobile / ai-platform）：直接 import schema 与类型，附带运行时校验。
- **Rust 侧**（im-core）：serde 结构体 `rename_all = "camelCase"` 与 JSON 对齐；`crates/chat/tests/contract_test.rs` 读取 `fixtures.json` 做往返校验，防止两侧漂移。

## 契约纪律

1. 字段**只加不改**；废弃字段保留并注释 `@deprecated`。
2. 新消息内容类型只增 `Content` discriminatedUnion 分支；客户端对未知类型降级为文本。
3. 修改契约后同步更新 `src/fixtures.ts`，然后：

```bash
pnpm --filter @chappie/contract export:fixtures
```

4. 双侧测试：`pnpm --filter @chappie/contract test`（TS）与 `cargo test -p im-core-chat`（Rust，在 core/ 下）。
