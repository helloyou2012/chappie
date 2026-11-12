/**
 * @chappie/contract —— 契约唯一真相（无 protobuf 方案）。
 *
 * 纪律（等价于设计文档 §28.2 proto「只加不改」）：
 *   1. 字段只加不改不改名；废弃字段保留并标 @deprecated；
 *   2. 新消息类型只增 discriminatedUnion 分支，客户端对未知分支降级为文本；
 *   3. 修改契约后必须同步更新 fixtures.ts 并重新导出 fixtures.json
 *      （pnpm --filter @chappie/contract export:fixtures），双侧契约测试才会保持绿色。
 */

export * from './admin';
export * from './ai';
export * from './cards';
export * from './chat';
export * from './device';
export * from './events';
export * from './fixtures';
export * from './frames';
export * from './identity';
export * from './rest';
