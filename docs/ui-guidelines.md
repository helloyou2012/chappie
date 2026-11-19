# Chappie UI 规范（v1）

一套面向「AI 分身 IM 工作台」的设计语言：macOS 暖灰玻璃质感 + 精确排版与透明度层级。

> **文档定位**：色彩、排版、间距、组件规格的唯一来源（Web 与移动端共享 token）。
> 移动端组件实现见 `apps/mobile/src/ui`；功能完成度见 [status.md](status.md)。

**目录**：`0` 设计原则 · `1` 色彩 Token · `2` 字体与排版 · `3` 间距与布局 ·
`4` 圆角/边框/阴影 · `5` 组件规格 · `6` 动效 · `7` 图标 · `8` 使用约定 · `9` 移动端设计系统

## 0. 设计原则

1. **内容优先**：界面本身保持安静，层级靠透明度、发丝线与明度差承担，不用大面积彩色与重阴影。
2. **透明度分层**：交互层级 = 白罩（深色）/ 黑罩（浅色）加一档：`veil → raised → hover → selected`。
3. **精密排版**：小字号、负字距、三档字重（400 / 510 / 590）、数字表格化（tabular-nums）。
4. **软壳硬内容**：外壳与浮层允许玻璃（backdrop-blur），气泡与卡片保持接近不透明的「纸片」质感。
5. **克制强调**：品牌色与语义色只做信息点（图标、圆点、下划线、tint），不做装饰面。
6. **会话级强调色（预留）**：目标态是每个分身拥有独立 accent（青绿 / 琥珀 / 靛紫 / 紫 / 蓝 / 橙红），
   以 tint、角标、开关、focus 边框的形式小面积出现；当前统一使用青绿 `#54b9a6`。
7. **布局线条克制**：三分栏的**大板块边界**保留 1px `line` 边框（侧栏右缘、成员面板左缘）；
   板块**内部**不画分隔线（头部、输入区、侧栏内部、成员分组等），用 surface 明度差
   （`canvas` vs `view` vs `panel`）与间距区分；线条只保留在：板块边界、卡片边界、
   列表行、工具区/面板底栏、输入控件边界、语义提示（warning/danger 卡片、Toast 左缘线）。

## 1. 色彩 Token

双层 token：主题层（`@theme inline`）→ CSS 变量，`.dark` 切换深色。

### 1.1 表面与文本

| 语义        | 变量               | 浅色                  | 深色                     |
| ----------- | ------------------ | --------------------- | ------------------------ |
| 应用画布    | `--canvas`         | `#f2f2f0`（暖灰）     | `#101010`                |
| 内容视区    | `--view`           | `#ffffff`（白）       | `#151515`                |
| 面板 / 卡片 | `--panel`          | `#ffffff`（白）       | `#1c1c1c`                |
| 浮层 / 输入 | `--elevated`       | `#ffffff`             | `#232323`                |
| 主文本      | `--ink-primary`    | `#0a0a0a`             | `#f2f2f2`                |
| 次文本      | `--ink-secondary`  | `rgb(10 10 10 / .56)` | `rgb(255 255 255 / .58)` |
| 三级文本    | `--ink-tertiary`   | `rgb(10 10 10 / .38)` | `rgb(255 255 255 / .36)` |
| 四级文本    | `--ink-quaternary` | `rgb(10 10 10 / .26)` | `rgb(255 255 255 / .25)` |

### 1.2 交互白罩（核心层级）

| 语义     | 变量                 | 浅色                   | 深色                      | 用途                        |
| -------- | -------------------- | ---------------------- | ------------------------- | --------------------------- |
| veil     | `--surface-veil`     | `rgb(10 10 10 / .03)`  | `rgb(255 255 255 / .02)`  | 静息 pill、输入区、弱填充   |
| raised   | `--surface-raised`   | `rgb(10 10 10 / .05)`  | `rgb(255 255 255 / .03)`  | hover、tab 表面、选中卡片   |
| hover    | `--surface-hover`    | `rgb(10 10 10 / .075)` | `rgb(255 255 255 / .05)`  | 图标按钮 hover、accent 背景 |
| selected | `--surface-selected` | `rgb(10 10 10 / .1)`   | `rgb(255 255 255 / .078)` | 激活态                      |

### 1.3 边框

| 语义   | 变量            | 浅色                  | 深色                     |
| ------ | --------------- | --------------------- | ------------------------ |
| 发丝线 | `--line`        | `rgb(10 10 10 / .1)`  | `rgb(255 255 255 / .12)` |
| 强描边 | `--line-strong` | `rgb(10 10 10 / .16)` | `rgb(255 255 255 / .18)` |

- 默认 1px；容器内部分隔可用 0.5px。
- 焦点态：输入类控件用边框变色（`color-mix(in srgb, var(--brand) 55%, transparent)`）；按钮等可交互元素不使用 ring，键盘焦点依赖全局 `:focus-visible` outline。组件不要用 `focus-visible:outline-none` 屏蔽该 outline。

### 1.4 品牌与语义色

| 语义    | 变量        | 浅色       | 深色       |
| ------- | ----------- | ---------- | ---------- |
| 品牌    | `--brand`   | `#0285f7`  | `#4da3f8`  |
| 信息    | `--info`    | `#0a84ff`  | `#64b5ff`  |
| 成功    | `--success` | `#1f8a65`  | `#3dbd8a`  |
| 警告    | `--warning` | `#b7791f`  | `#f0bf00`  |
| 危险    | `--danger`  | `#d33a3a`  | `#f87171`  |
| tint 底 | `--*-soft`  | 对应色 12% | 对应色 16% |

> shadcn 别名 `--accent` 指向 `--surface-hover`，不是品牌色；品牌色请使用 `--brand` / `bg-brand` / `text-brand`。

### 1.5 分身强调色（会话级）

当前统一使用青绿 `#54b9a6`（`--agent-accent`），未实现按分身/会话注入。
多强调色（琥珀/靛紫/紫/蓝/橙红）为预留设计，接入时再补充 `.agent-accent-scope` 与会话映射。

派生：`--agent-tint`（8–12% 底色）、`--bubble-agent`（12–16% 气泡底）。

### 1.6 气泡

| 语义     | 浅色                             | 深色                        |
| -------- | -------------------------------- | --------------------------- |
| 自己     | 底 `#111110` / 字 `#ffffff`      | 底 `#ecece8` / 字 `#141414` |
| 他人     | `rgb(10 10 10 / .045)`           | `rgb(255 255 255 / .055)`   |
| 分身代发 | `agent-accent` 12% 底 + 混色文字 | 16% 底 + 混色文字           |

## 2. 字体与排版

```css
--font-sans: 'Inter', ui-sans-serif, -apple-system, 'SF Pro Text', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
--font-mono: 'Berkeley Mono', ui-monospace, 'SF Mono', Menlo, monospace;
```

- 全局：`-webkit-font-smoothing: antialiased`，正文 `letter-spacing: -0.011em`，字号基准 **14px**。
- 字重三档：`400` 正文 / `510` medium / `590` semibold。
- 数字密集视图加 `tabular-nums`。

| 字号    | 行高 | 字距     | 用途                   |
| ------- | ---- | -------- | ---------------------- |
| 10px    | 1.5  | -0.015em | 头像缩写、极小编号     |
| 11px    | 1.4  | 0        | 徽标、表头             |
| 12px    | 1.4  | 0        | 元信息、时间、预览     |
| 13px    | 1.5  | -0.01em  | 列表主文字、导航、按钮 |
| 14px    | 1.45 | -0.013em | 正文、气泡、输入       |
| 16px    | 1.5  | -0.012em | 区块标题               |
| 20px    | 1.3  | -0.012em | 页面标题               |
| 24–32px | 1.25 | -0.02em  | 登录页/统计数字        |

## 3. 间距与布局

- 4px 网格，允许 2px 半档：`2 / 4 / 6 / 8 / 10 / 12 / 14 / 16 / 20 / 24 / 32`。
- 应用外壳：画布上/下/右内边距 4px，左侧 0；统一卡片右侧距窗口 4px；桌面端窗口圆角 24px。
- 左侧 IconRail：整体 72px = 60px 栏 + 左右各 6px 外边距；
  品牌 Logo 32px + 导航图标 20px + 11px 标签 + 主题/账户；透明背景。
  macOS 桌面端顶部预留 40px 标题栏安全区；整条图标栏、会话栏标题、聊天标题、成员栏标题均可拖拽窗口。
- 会话列表栏 272px（统一卡片内的左栏，`border-r` 分隔：标题 + 新建 + 列表 + 连接状态）。
- 聊天页为三栏单卡布局：会话栏 272px | 聊天区 `flex-1` | 成员栏 300px；
  内部用 1px `line` 边框分隔，整张卡片使用 `rounded-2xl`（16px）+ `shadow-card`。
- 会话栏与成员栏可拖拽调整宽度：默认 272 / 300，范围 220–400 / 240–420；
  命中区 8px，视觉线 1px 上下渐隐，悬停/拖拽时显示；宽度持久化到 localStorage。
  其他页面（联系人 / 审批 / 日程 / 分身 / 日报）共用同一张卡片，但不显示会话栏，内容区占满整卡。
- 主聊天头部 56px，左右结构：左侧会话标识 + 标题/副标题，右侧档位；`px-3`。
- 输入面板为浮动圆角卡片：`rounded-2xl` + `shadow-pop`，与内容区留 12px 间距。
- **头部 / 工具栏 48px**，`px-4`（聊天头部单独 56px）。
- 聊天内容最大宽度：自己与对方气泡统一 `max-w-[72%]`。
- 消息间距 12px，日期分隔 24px。

## 4. 圆角 / 边框 / 阴影

| Token           | 值      | 用途                                                        |
| --------------- | ------- | ----------------------------------------------------------- |
| `--radius-sm`   | 6px     | 仅内嵌控件（分段按钮）                                      |
| `--radius-md`   | **8px** | **默认**：按钮、输入框、卡片、列表项、下拉菜单、Tabs、Toast |
| `--radius-lg`   | 10px    | 少用，预留                                                  |
| `--radius-xl`   | 12px    | 特殊大容器：弹窗、聊天输入区、登录卡片                      |
| `--radius-2xl`  | 16px    | 特殊：消息气泡                                              |
| `--radius-full` | 9999px  | 胶囊、头像、开关                                            |

阴影仅用于真正浮起的元素：

```css
--shadow-inset-hairline: inset 0 0 0 1px var(--line);
--shadow-card: 0 0 0 1px rgb(0 0 0 / .03);
--shadow-pop: 0 4px 16px -4px rgb(0 0 0 / .12), 0 1px 2px rgb(0 0 0 / .06);
--shadow-panel: 0 12px 40px -12px rgb(0 0 0 / .25);
```

**浅色表面约定**：应用画布保持暖灰 `#f2f2f0` 作为外框，内容区（会话列表 / 聊天区 / 成员栏 /
业务页）与卡片统一纯白 `#ffffff`；层级靠 1px 发丝线、白罩（`surface-*`）与阴影区分，
不再依赖接近白的灰阶差。暗色模式：canvas `#101010`、view `#151515`、panel `#1c1c1c`、elevated `#232323`。

玻璃（当前仅 Toast 使用）：`background: panel 72% + backdrop-blur(20px) saturate(160%)`；
联系人页吸顶分组头使用 `backdrop-blur`，属于列表级局部例外。

**弹窗（Dialog）例外**：使用不透明底色 `--elevated`（浅色 = 纯白 `#ffffff`，深色 = `#1c1c1c`）

- 1px `line` 边框 + `shadow-pop`，不使用玻璃。弹窗面积大、内容多，半透明底会与背后聊天内容混色，
  降低可读性；玻璃只留给 Toast。
  卡片边缘高光：`card-edge` utility（左上角径向遮罩的 1px 白色高光，深色更明显）。

## 5. 组件规格

| 组件                      | 规范                                                                                                                                                                                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Button                    | **仅两档尺寸：32（default，主操作）/ 28（sm，次级）**；图标按钮 32×32（icon）/ 28×28（icon-sm）；同级按钮尺寸必须一致；圆角 8；**尽量少用 border**——靠背景层级区分，实心按钮不加描边；**hover 不位移、不缩放**；**不使用 ring**                                                                             |
| IconButton                | 32×32（icon）/ 28×28（icon-sm），圆角 8 或圆形，默认无边框，`ink-tertiary`，hover 白罩 + 提亮                                                                                                                                                                                                               |
| Card                      | 普通卡片圆角 8（`--radius-md`）；应用主卡片（聊天单卡）圆角 16 + `shadow-card`；1px `line` 边框；普通卡片靠边框与底色分层，不使用阴影                                                                                                                                                                       |
| Input / Select / Textarea | 圆角 8–12，1px `line`，`elevated` 底；Input/Select 高度与 Button 对齐（default 32 / sm 28），同一行必须一致；Textarea 可多行；focus 边框 brand 55%，无粗 ring                                                                                                                                               |
| Badge                     | 胶囊，高 18，11px/510，可带 5px 圆点；**无边框**——用 tint 底色（语义色 15%）与文字色区分；`outline` 变体为纯文字标签                                                                                                                                                                                        |
| Dialog                    | 圆角 12，**不透明白底（`elevated`）+ 1px 边框 + `shadow-pop`** + 遮罩 `black/40` + blur(4px)；不使用玻璃底，保证大块内容的可读性                                                                                                                                                                            |
| Dropdown                  | 圆角 8，不透明 `bg-popover` + `shadow-pop`，项高 30，hover `surface-hover`                                                                                                                                                                                                                                  |
| Tabs                      | 高 28，圆角 8，选中 `surface-selected` + 主文本（Base UI 用 `aria-selected`，不要写 `data-[selected]`）。日程页视图切换使用分段按钮：容器 `bg-surface-veil`、h-28、选中 `bg-brand-soft` + `text-brand`                                                                                                      |
| Switch                    | 30×18 胶囊，开启 `brand`，14px 旋钮，无阴影                                                                                                                                                                                                                                                                 |
| 左侧图标栏导航            | 导航项宽 56、圆角 12、图标 20px + 11px 标签；图标栏 60px（含左右 6px 外边距共 72px）；选中 `bg-panel` + `shadow-card`，未选中 `ink-tertiary`                                                                                                                                                                |
| 会话列表项                | 头像 36px；项圆角 12、内边距 12；选中 `surface-raised` + `shadow-card`；未读徽标 brand 胶囊                                                                                                                                                                                                                 |
| 栏宽拖拽                  | 命中区 8px，视觉线 1px 上下渐隐；默认会话栏 272 / 成员栏 300，宽度持久化                                                                                                                                                                                                                                    |
| 消息气泡                  | 圆角 16，正文 14/1.45，`px-3.5 py-2`；分身气泡 = agent tint + 「AI 代发」角标                                                                                                                                                                                                                               |
| 聊天输入                  | **一体化输入面板**：圆角 16、`panel` 底、1px `line/70` 边框、无内部分隔线；文本域 14px 透明底 + 底部工具行（左：@ 提及按钮 28×28 + 「Enter 发送 · Shift+Enter 换行」提示；右：圆形发送按钮 28×28，secondary 底色）；`focus-within` 边框变品牌色 45%；回复条 / 已选提及在面板内顶部                          |
| Toast                     | 圆角 8，`shadow-pop`，玻璃，左上缘 2px 语义色线                                                                                                                                                                                                                                                             |
| Command Palette           | `⌘K / Ctrl+K` 打开；白底浮层 + 1px 边框 + `shadow-panel`；输入框无边框；结果按「会话 / 联系人 / 跳转 / 操作」分组；`↑↓` 选择、`Enter` 打开、`Esc` 关闭；行高约 40（`py-2` + 24 图标），选中 `surface-raised`                                                                                                |
| Avatar                    | 圆形；16 色（紫/蓝/青/绿/橄榄/琥珀/棕/橙红/粉/洋红/酒红，提取自 Avatar Color Generator），按**大写首字母**稳定分配（英文 A–Z，中文取拼音首字母）；首字自适应对比（深底白字 / 浅底深墨 `#141414`，≥ 4.5:1）；**不加描边**；AI 分身与真人共用同一底色，通过 AI 角标 / 「AI 代发」标志区分（不使用独立背景色） |

### 5.1 日程 / 日历（Web）

- 页面分两栏：左侧 248px 迷你月历 + 搜索 + 「我的日历 / 我的任务」+ 未安排日程；右侧日历主区。
- 顶部工具栏 48px：`今天`、前后翻页、日期标题、日 / 周 / 月分段控件。
- 日 / 周视图：时间轴每小时 56px，左侧刻度槽 16px；GMT+8 标签 sticky 在左上角；
  日程条 `bg-brand-soft` + 3px 左描边 `brand`，单行展示「标题，14:30 - 15:00」。
- 当前时间：1px `danger` 横线 + 左侧 `HH:mm` 标签 + 今天列圆点；进入视图时滚动到当前时间前两小时。
- 月视图：6×7 网格；今天用 `brand` 实心圆；单元格最多 3 条日程 + 「+N 更多」；当前周浅灰底。
- 交互：点击空白时间段 / 单元格「+」新建；点击日程打开详情并删除；新建弹层宽 440px，
  标题输入 20px/590，日期与时间同排，底部为取消 / 保存。
- 移动端保持 44px 小时行 + 列表形态，不套用 Web 网格。

### 5.2 联系人（Web）

- 左侧为按拼音首字母分组的联系人列表，右侧固定字母索引条；分组头吸顶并使用局部 `backdrop-blur`。
- 顶部搜索 + 「添加联系人」；联系人行展示头像、名称、别名与分身档位。
- 删除等破坏性操作使用 Dialog 确认，不使用原生 `confirm()`。

## 6. 动效

- 缓动：进场 `cubic-bezier(0.16, 1, 0.3, 1)`（`--ease-out-quad`）、屏幕内移动 `cubic-bezier(0.77, 0, 0.175, 1)`（`--ease-in-out`）。
- 时长：按压 100–160ms、Tooltip/Popover 125–200ms、菜单 150–250ms、弹窗/抽屉 200–500ms；
  界面动效默认不超过 300ms，更长的时间只用于解释空间变化。
- `prefers-reduced-motion` 是设计态：保留透明度与颜色反馈，移除位移、缩放、视差与弹簧过冲；
  移动端通过 `useReducedMotion()` 把浮层改为无动画。
- 消息入场 280ms（`translateY(8px) scale(.97)` + 淡入，轻微过冲）。
- 弹窗 200–280ms（淡入 + 1px 缩放）。
- typing 三点 1.2s 循环；AI 运行态可用 2s 流光（仅此处允许持续装饰动效）。
- `prefers-reduced-motion: reduce` 时关闭所有非必要动画。

## 7. 图标

- 线性图标 14–20px，描边 1.5–2px；左侧图标栏导航固定 20px。
- 默认 `ink-tertiary`，hover 提亮；语义图标用对应语义色。
- 导航级图标固定 16px；行内语义图标按语境 10–16px；分身相关图标使用 agent accent 色或 tint。
- 桌面端可拖拽区域通过 `data-tauri-drag-region` 标记；Tauri capability 需包含 `core:window:allow-start-dragging`。

## 8. 使用约定

- 优先使用 token 类：`bg-canvas` `bg-panel` `text-ink` `text-ink-secondary` `border-line`
  `bg-surface-veil/raised/hover/selected` `bg-agent` `text-agent` 等；
  禁止在业务组件中硬编码十六进制颜色（品牌渐变除外，集中定义在 token 层）。
- 语义别名：`background` `foreground` `card` `popover` `primary` `secondary`
  `muted` `accent` `destructive` `border` `input` `ring` `ai` 已映射到上述 token。
- **机器数据用等宽**：ID、trace id、工具名、参数、时间一律 `font-mono` + `tabular-nums`；正文保持无衬线。
- **审批卡文案**：按钮写「批准（仅本次）」，并注明「长期授权请在分身控制台的策略/能力中调整」，避免把一次性批准误读为永久授权。
- 状态表达优先顺序：文字层级 → 白罩层级 → 语义色 tint → 语义色实心（最少用）。
- 每个新建组件先对照本规范选择 token，再写样式；新增 token 必须同时补充浅色与深色两套值并更新本文档。

## 9. 移动端设计系统（`apps/mobile/src/ui`）

移动端与 Web 共用同一套视觉令牌（`apps/mobile/src/theme.ts` 与本文 1.x 同源），
但交互形态按触屏重排：悬浮操作 → 长按菜单，常驻侧栏 → 底部抽屉，快捷键提示 → 触控按钮。

**硬性约定**

1. 页面与业务组件**只从 `@/ui` 取组件**，不直接 `import { Text, TextInput, ActivityIndicator, Switch, Modal } from 'react-native'`。
2. 文本一律用 `<Text variant tone>`：`variant` ∈ `h1 h2 title subtitle body bodySm caption micro`；
   `tone` ∈ `default muted tertiary primary onPrimary danger success warning ai agent`。
   页面文本优先用 `Text variant tone`；仅登录页大标题等一次性样式可直接写 `fontSize`，并尽量避免硬编码颜色。
3. 表面用 `<Card>` / `<Divider>` / `<PageHeader>` / `<Screen>`；不手写 `backgroundColor + borderRadius + borderWidth` 组合。
4. 操作用 `<Button variant size tone loading>` / `<IconButton icon label>`；`label` 必填（无障碍）。
5. 表单用 `<Field label hint>` + `<Input multiline>`；选择用 `<SegmentedControl>` / `<ChipRow>` / `<Toggle>`。
6. 浮层用 `<BottomSheet>`（侧重操作/表单）与 `<Dialog>`（确认/纠错）；菜单行用 `<MenuRow>`。
7. 列表行用 `<ListRow leading title subtitle trailing onPress>`；空态用 `<EmptyState>`；加载用 `<Spinner>`；
   头像用 `<Avatar name variant>`（统一单色底与 Web 共用 `avatarColor`；AI 变体共用底色，通过角标区分）。
8. `View` 仅用于布局（flex 容器、间距、进度条等非组件化结构）；新增可复用的视觉形态必须先沉淀到 `ui/`。

**组件清单**：`Text` `Screen` `PageHeader` `Card` `Divider` `Button` `IconButton` `Field` `Input`
`Badge` `SegmentedControl` `Chip` `ChipRow` `Toggle` `BottomSheet` `Dialog` `MenuRow` `ListRow`
`EmptyState` `Avatar` `Spinner` `space`（间距刻度）。

**移动端尺寸差异**

| 元素   | 移动端规格                                                                 |
| ------ | -------------------------------------------------------------------------- |
| Button | 高 44（md）/ 34（sm），圆角 11 / 9；图标按钮 34–44（`IconButton size`）    |
| Input  | 高 44（md）/ 34（sm），多行默认 minHeight 44；**同行必须与 Button 同档位** |
| Card   | 圆角 16，1px 边框，默认内边距 14；`tone` 支持 warning / danger 强调        |
| 浮层   | `BottomSheet` 顶部圆角 22，含底部安全区；`Dialog` 圆角 16，居中            |
| 页面   | `PageHeader` 自带状态栏安全区；二级页传 `onBack` 显示返回按钮              |
| 列表行 | `ListRow` 高约 48（py 8），选中/按下分别用 `surface-raised` / `hover`      |

**主题**

- 三档模式：跟随系统 / 浅色 / 深色（`apps/mobile/src/store/theme.ts`，持久化 key `chappie.theme`，与 Web 同 key）。
- 所有组件通过 `useTheme()` 取色；切换模式即全量重渲染，`StatusBar` 跟随解析后的实际明暗。
- 页面与组件禁止硬编码颜色（`Badge` 的 tint 由语义色派生，属 token 内运算）。
- 服务地址等**部署配置不得出现在用户界面**，仅 `__DEV__` 构建保留调试入口。
