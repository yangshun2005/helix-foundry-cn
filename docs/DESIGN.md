# Helix 设计标准

这些标准描述了当前的产品样式、外壳和组件契约。它们涵盖工作区及其引导流程。实现是唯一的事实来源；请复用其中的令牌和组件。

## 源文件映射

| 源文件                                                                                          | 职责                                                                                                  |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [`style.css`](../apps/web/src/style.css)                                                        | Tailwind 和原始基础样式；后续层会覆盖它们                                                             |
| [`minimal.css`](../apps/web/src/minimal.css)                                                    | 引导流程和早期页面，包括设置宽度和响应式规则                                                          |
| [`workspace.css`](../apps/web/src/workspace.css)                                                | `.hf-app` 内的工作区令牌、主题和基础样式，以及旧令牌的桥接层                                          |
| [`kit/index.ts`](../apps/web/src/kit/index.ts) 和 [`kit/kit.css`](../apps/web/src/kit/kit.css) | 共享控件、页面容器、表格、面板和状态组件                                                              |
| [`shell/shell.css`](../apps/web/src/shell/shell.css)                                            | 工作区外壳：侧边栏、移动栏和导航抽屉、命令面板、活动托盘和 Toast 通知                                 |

`main.tsx` 按此顺序导入这些样式表，因此相同特异性的规则中，后加载的规则会覆盖先加载的规则。其他样式表随导入它们的组件一起加载：[`ontology-scene.css`](../apps/web/src/ontology-scene.css)（由 `ontology-scene.tsx` 导入）包含设置插图、其薄荷色活动标记和数据源；`suggested-ontology.css` 包含建议本体审核；`areas/` 下的每个工作区区域都有自己的样式表。在从较早的样式表中复制值之前，请先阅读最终的规则及其作用域。

## 视觉语言

- 温暖的纸张质感表面、橄榄色墨迹、精细边框和克制的薄荷色点缀。
- Georgia 展示标题；Inter/系统无衬线字体用于控件和正文。
- 平静的布局，留有充裕空间，标签简短，说明平实。
- 图标与文字搭配使用；将强烈色彩保留给活动、选中和状态。

工作区令牌位于 `apps/web/src/workspace.css`：`--hf-*` 字体、颜色、字号、间距、圆角、阴影和动效。工作区组件位于 `apps/web/src/kit`。引导流程在 `.hf-app` 之外渲染，使用 `minimal.css` 实现其浅色纸张主题、14px 正文、760px 居中页面，以及在 600px 及更窄时 22px 的侧边留白。每个步骤的标题（`.setup-content > h1`）为 34px Georgia，在 600px 及更窄时为 29px；建议本体的标题（`suggested-ontology.css` 中的 `.so-head h1`）也是 34px，在 699px 及更窄时为 28px。标题下方的介绍文字（`.setup-intro` 以及建议的摘要）为 15px；大多数其他辅助文字为 12–13px。建议本体的 Schema 画布比页面更宽：最大 1120px，四列或更多列时为 1320px。插图和数据源位于 `ontology-scene.css`。设置样式使用固定的浅色而非 `--hf-*` 令牌，且设置不使用 kit，因此工作区深色模式不会影响引导流程。添加设置 UI 时请保持该主题。

## 进度与反馈

长时间运行的设置工作通过 [`setup-components.tsx`](../apps/web/src/setup-components.tsx) 中的 `OperationProgress` 展示：连接对话框中的导入（在设置的 Data 步骤，以及从工作区 Data 页面的"Add data"进入），以及本体确认后的工作区构建。它只展示服务器报告的内容：

- 一行状态，包含操作名称、排队或运行时的加载指示器、成功后的对勾，以及其状态："Ready"、取消操作的"Stopped"，否则为服务器的阶段或状态。构建将其阶段转换为平实的词语，例如"Building records"或"Publishing"，并附一行关于正在发生什么的说明（`onboarding.tsx` 中的 `buildStage`）。
- 在工作期间，一行详情：最新的进度消息或事件，或"Waiting to start"，后跟作业报告时的实测计数。导入显示"12,345 records read"，或从 S3 下载文件时显示"512 KB received"。构建发布期间，显示"12,345 records and 678 relationships read"（在读取到关系之前为"12,345 records read"）。没有百分比、总数或时间估算。
- 当操作失败或被停止时，显示包含服务器错误的警告，或"Progress has been saved. Retry when you're ready."
- 失败或停止的操作显示"Retry"，排队或运行中的操作显示"Stop"。构建在发布开始后隐藏"Stop"，因为服务器以原子方式完成发布。
- 该块是一个礼貌的实时区域，因此变化会被播报而不会打断。

没有屏幕显示进度条。当操作报告已知总数时，`OperationProgress` 可以绘制 `<progress>`，但它展示的操作中没有一个会报告总数。本地模型下载是唯一会报告总数的作业，且没有屏幕用 `OperationProgress` 展示它：设置在模型后台下载时继续推进，如果下载失败，后续步骤会显示通知，所有者的通知中包含"Retry AI connection"和"Change AI choice"。已知总数改为以文本形式出现，例如下方的样本计数和数据源表格计数。

`useSetup` 在样本数据加载、AI 描述建议本体或工作区构建时每秒轮询引导状态，其他情况每 2.5 秒轮询一次。轮询失败时屏幕上保留最后的状态；仅当尚未加载任何状态时，设置才显示错误。样本加载期间，按钮会统计已知工作："Loading sample data… (3 of 11)"。样本加载若 12 秒内没有推进，会被恢复一次。

Ontology 步骤的数据源（`ontology-scene.tsx` 中的 `DataFeed`）展示每个源的表格陆续到达：任何表格加载中时显示"3 of 5 tables"，然后显示已读取的记录数。放不下的表格名称会用省略号截断，并在工具提示中携带完整名称。一行礼貌的状态显示当前步骤和目前已读取的表格。步骤（`ontology-step.tsx`）混合了服务器状态和节奏控制。Reading 等待服务器读取表格，matching 等待服务器的建议，"AI is writing descriptions"等待 AI 运行，在建议到达后最多等待 20 秒。"Finding keys"和"Proposing entities"在客户端计时。每个步骤都保持足够长的时间以便阅读，因此建议至少在步骤打开 3.5 秒后出现，且绝不会早于服务器生成它。返回该步骤或重新加载它时，会立即显示已有的建议。

在新的进度 UI 中遵循相同的原则：

- 从服务器状态获取状态、完成和失败信息。装饰性子步骤可以在客户端控制节奏以便每个都能被阅读，但结果绝不会在服务器报告之前出现。展示实测的计数；绝不要编造百分比或时间估算。
- 用平实的词语命名阶段。设置将业务成果保持在视野中，将基础设施放在展开项中。
- 保持"Stop"和"Retry"可用，但发布开始后除外"Stop"。
- 礼貌地播报变化，绝不播报跳动的数字：Analyst 工作时的已用时间对屏幕阅读器隐藏。
- 图标与文字搭配，使状态绝不单独依赖图标或颜色。
- 以语义方式标记步骤。数据源的步骤是有序列表；设置步骤指示器（"AI"、"Data"、"Ontology"）是一个 `nav`，用 `aria-current="step"` 标记当前步骤。
- 尊重 `prefers-reduced-motion`。设置将动画时长削减至 0.01ms 并移除过渡；插图、数据源和建议本体停止动画；工作区将动画和过渡时长削减至 0.01ms 并将每个动画限制为一次迭代。
- 绝不让长名称在窄宽度下溢出。操作名称会换行（`overflow-wrap: anywhere`）；在名称被截断的地方（如数据源中），其完整文本在工具提示中。

## 工作区基础

在工作区样式中使用语义化的 `--hf-*` 令牌。下面的浅色调色板是识别产品的参考；深色模式会覆盖这些相同的角色。

| 角色               | 令牌               | 现有浅色值           |
| ------------------ | ------------------ | -------------------- |
| 纸张背景           | `--hf-bg`          | `#f8f7f3`            |
| 凸起面板           | `--hf-raised`      | `#fdfcf9`            |
| 凹陷表面           | `--hf-sunken`      | `#f0efe9`            |
| 正文文字           | `--hf-text`        | `#292a26`            |
| 次要文字           | `--hf-text-2`      | `#4f534a`            |
| 辅助文字           | `--hf-muted`       | `#65675e`            |
| 分隔线             | `--hf-border`      | `#e4e2da`            |
| 主要操作墨迹       | `--hf-ink`         | `#343932`            |
| 薄荷色点缀         | `--hf-accent`      | `#36b98a`            |
| 点缀文字           | `--hf-accent-text` | `#2d6a4b`            |
| 键盘焦点           | `--hf-focus`       | `#2a8f69`            |

保持填充和文字角色区分：较亮的薄荷色是点缀，而较暗的点缀文字用于标签。`--hf-faint` 用于图标和装饰。不要在工作区页面中用仅浅色的十六进制颜色替换语义化令牌。工作区支持系统深色模式和显式主题选择；设置在 `.hf-app` 之外保留其浅色纸张主题。

现有字号为 11、12、13、14、16、20、26 和 34px。使用匹配的 `--hf-text-*` 角色。正文和控件使用 `--hf-font-sans`；展示标题使用 `--hf-font-display`；标识符和代码使用 `--hf-font-mono`。工作区页面标题为 26px，在 800px 及更窄时为 23px。对指标、计数和计时器使用表格数字（`.hf-num`）。

间距令牌涵盖 4、8、12、16、24、32、40、48 和 64px。现有圆角为 6、8、12 和 16px，外加一个胶囊圆角。普通控件优先使用精细边框和 `--hf-shadow-1`；将更大的阴影保留给抬升的浮层。默认控件过渡使用 `--hf-duration`（160ms）和 `--hf-ease`。

## 页面和组件模式

| 需求             | 现有组件和约定                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 页面布局         | `Page` 配合 `narrow`、`default`、`wide` 或 `full` 宽度；`PageHeader` 用于标题、副标题、元数据、操作和可选标签页                     |
| 页面内导航       | `Breadcrumbs` 用于层级；`Tabs` 和 `TabPanel` 用于同级视图；用 `useTabParam` 将选中的标签页保留在 URL 中                              |
| 操作             | `Button`、`ButtonLink`、`ButtonAnchor` 和 `IconButton`；根据是执行操作还是导航来选择元素                                              |
| 数据检查         | `DataGrid`、`Toolbar`、`SearchInput`、`FilterSelect` 和 `FilterBar`；保持筛选和行操作一致                                             |
| 分组内容         | `Section`、`Panel`、`SplitView` 和 `KeyValue`；保持页面、区块和记录详情之间的层级                                                     |
| 指标             | `StatCard`、共享数字格式化，以及 Home 的 `TrendChart` 和 `BreakdownChart`                                                            |
| 源标识           | `SourceLogo` 和 `SourceStack`，使用现有的连接器标签和徽标                                                                             |
| 状态和反馈       | `StatusBadge`、`StatusDot`、`EmptyState`、`Skeleton` 和 `SkeletonText`                                                               |
| 浮层             | `Dialog`、`ConfirmDialog` 和 `DropdownMenu`；使用共享的焦点、关闭和键盘行为                                                          |

按钮有五种现有变体：primary、secondary、ghost、accent 和 danger。它们的小、中、大高度分别为 28、34 和 40px。主要操作使用 primary，常规替代项使用 secondary，更安静的操作使用 ghost，破坏性操作使用 danger。组件的 `pending` 状态会禁用重复提交并暴露 `aria-busy`。仅图标按钮需要有意义标签。

状态是共享语言：queued 和 draft 为中性；running 和 syncing 使用 info；healthy 和 succeeded 使用 success；stale 和 review 使用 warning；failed 使用 danger；paused 和 canceled 为中性。使用现有的 `toStatus`、`statusLabel` 和 `statusTone` 映射，而不是独立分配新颜色或标签。

图表尚未共享一个调色板：

- Home 的关键指标以单一系列颜色 `--wk-series` 绘制 `TrendChart` 和 `BreakdownChart`（[`metrics.tsx`](../apps/web/src/areas/workspace/metrics.tsx)）：浅色模式下为 `--hf-accent-strong`，深色模式下为固定的 `#32aa7f`（`home.css`）。
- Analyst 回答复用这两个图表，将 `--wk-series` 设为 `--hf-chart-1`（`analyst.css`）。
- Review changes 页面上的图表预览（`review.tsx`）在 [`charts.tsx`](../apps/web/src/charts.tsx) 中使用 Recharts，带有硬编码的浅色（`#548b72`、`#dfebe4` 和 `#679780`），不遵循深色模式。
- 本体类型从 [`colors.ts`](../apps/web/src/areas/ontology/colors.ts) 中每个主题固定的八色调色板取色，按视图已知类型的字母顺序排列；第九个及之后的类型为灰色。Explorer 的图对其已加载记录的类型排序，其表格对每个有记录的类型排序。在图中隐藏某个类型或在表格中选择某个类型时，所有颜色保持不变，但一个类型的颜色在完整图、聚焦于单条记录的图和表格之间可能不同。
- `--hf-chart-2` 到 `--hf-chart-6` 已定义但未使用。

为新图表提供来自令牌的主题感知颜色，而不是新的十六进制值。Home 和回答图表不依赖颜色来解释数据：每个都是可聚焦的图像，其标签概括了数值，方向键逐步浏览各点，礼貌的实时区域播报每一个，条形值打印在条形旁边。工具提示和实时区域将每个值完整拼出（图表标签或条形显示"$12.4K"处为"$12,400"），但仍按 `formatMetric` 的方式四舍五入：数字和百分比在 10 以下最多两位小数，10 及以上一位小数，货币精确到分，或对于整数金额或 $10,000 及以上精确到美元。回答以数字形式发送的整数在那里保留每一位，即使超过 2^53。使用 kit 的 `formatNumber`、`formatCompact`、`formatDate` 和 `formatRelative` 格式化值；Home 用 `metrics.tsx` 中的 `formatMetric` 格式化指标值，包括货币。

## 响应式和可访问行为

工作区外壳有 236px 的侧边栏和 60px 的折叠变体。在 800px 及更窄时，带导航抽屉的顶部栏取代侧边栏。使用外壳的响应式规则，而不是给新页面自己的导航布局。在相同宽度下，页面头部操作移到标题下方。保持标签可读，辅助文字换行，并将宽表格限制在其数据视图内。同时检查正常视口和 390px 手机视口。

工作区焦点使用 2px 的 `--hf-focus` 轮廓；设置有自己的可见 2px 轮廓。使用真正的按钮、链接、标题、带标签的控件和表格语义。播报有意义的状态变化和错误，并对辅助技术隐藏装饰性图标。`Dialog` 是原生模态 `<dialog>`：它捕获焦点，用 Escape 或背景关闭，并在关闭时返回焦点。对外壳和设置都尊重 `prefers-reduced-motion`。

在交付 UI 更改之前，检查其最终样式作用域、pending 和失败状态、键盘标签、移动端换行和减少动效行为。在改进反馈或恢复时，保留已连接的源和用户数据。