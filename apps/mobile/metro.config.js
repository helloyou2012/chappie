// Metro monorepo 配置：让移动端能解析 workspace 包（@chappie/shared / contract）。
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// 注意：不要开启 disableHierarchicalLookup —— pnpm 的依赖嵌套在 .pnpm 目录中，
// 需要保留逐级向上查找才能解析包内部依赖（如 @expo/metro-runtime → whatwg-fetch）。

module.exports = config;
