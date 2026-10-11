# Helix Foundry 指南

本指南是 [README](../README.md) 的详细配套文档。它涵盖了 Helix Foundry 的功能、如何连接各类数据源、AI 与审核的工作方式、各服务如何协同、以及如何开发和测试代码。如需安装，请从 README 或 [agent 运行手册](../AGENTS.md) 开始。如需日常运行安装实例，请参阅[运维文档](OPERATIONS.md)。

## 目录

- [功能特性](#功能特性)
- [界面导航](#界面导航)
- [引导式设置与示例数据](#引导式设置与示例数据)
- [连接数据源](#连接数据源)
  - [托管数据库：Neon、Supabase 和 PlanetScale](#托管数据库neonsupabase-和-planetscale)
  - [PostgreSQL 和 MySQL](#postgresql-和-mysql)
  - [Stripe](#stripe)
  - [WorkOS](#workos)
  - [PostHog](#posthog)
  - [REST API、文件、S3 和摄取 API](#rest-api文件s3-和摄取-api)
  - [同步与变更捕获](#同步与变更捕获)
- [AI 与审核](#ai-与审核)
- [架构](#架构)
- [安全性](#安全性)
- [本地开发](#本地开发)
- [测试](#测试)
- [备份与升级](#备份与升级)

## 功能特性

Helix Foundry 是一个 AI 辅助的数据工作空间，运行在你自己的计算机上，基于 HelixDB 和 DuckDB 构建。你可以连接数据、确认建议的本体或描述预期结果、检查经过测试的提案，并在 Home 上发布带有键指标的共享本体。默认使用本地推理；Claude 和 OpenAI 是显式的替代选项。

- **数据源：** PostgreSQL 和 MySQL 的发现与流式快照摄取，Neon、Supabase 和 PlanetScale 的登录，Stripe、WorkOS 和 PostHog，REST 分页，S3 兼容的文件导入，CSV、JSON、JSONL 和 Parquet 上传，以及批量摄取 API。
- **数据：** 不可变的 Parquet 快照、数据画像、键候选、敏感性提示、Schema 漂移审核、版本历史和导出。
- **AI 辅助：** 生成的目录描述、可执行的流水线 SQL、本体映射与关系、Home 键指标和操作建议。
- **流水线与问题：** 流水线可定义为编译为 SQL 的节点图（DAG），或可编辑的 SQL，并提供前后预览。只读的 AI 问题返回带有快照引用的执行结果。
- **审核：** 证据与查询预览、有界模型修复、过期提案检测、原子化生成发布和定义回滚。
- **本体：** HelixDB 中的真实本体对象和原生关系，带有经过审计的编辑覆盖层，可在重新物化后保留。
- **安全性：** 工作空间范围的、可选只读、可撤销的 API 令牌，加密的连接器和模型凭据，回环主机检查，以及浏览器变更的来源检查。
- **任务：** 带租约和崩溃恢复的持久化任务、定时数据源刷新、后台修复草稿、查询隔离和预算控制。
- **开发者访问：** 位于 `/api/docs` 和 `/api/openapi.json` 的 OpenAPI、TypeScript SDK、定义导入导出，以及备份、恢复和升级脚本。

## 界面导航

侧边栏包含 **Home**、**Ontology**、**Data** 和 **Analyst**，底部是 **Settings**。从侧边栏顶部的菜单切换工作空间。

- **Home** 显示工作空间的键指标：由 AI 从数据集 Schema 中挑选的增长和分析指标，或在 AI 设置完成前由代码挑选。仅当输入数据集有新版本时才会重新计算。可从顶部输入框提出任何关于数据的问题。Home 还显示连接、数据健康状况、需要关注的项目、上次离开的位置以及本体概览。旧的仪表盘链接会打开 Home。
- **Ontology** 打开时显示 **Explorer**，以图或表的形式展示你的记录及其连接方式。**Object types** 列出已发布的业务类型。打开一条记录可查看其相关记录和来源历史。对记录的编辑需要前后预览并显式应用。工作空间编辑不会改变导入的快照、Home 的指标或源系统。旧的 `/records` 链接会打开 Explorer。
- **Data** 将所有连接选项整合到一个 **Add data** 流程中。打开数据集可查看样本，展开 **Details** 可查看 Schema、画像、版本、血缘、导出和连接设置。旧的 Advanced 页面现在会打开 Data。
- **Analyst** 保存你与助手的对话。助手会判断请求需要执行答案还是经过测试的提案。后续追问会保留所选资源。路由使用与本次运行其余部分相同的模型调用和令牌预算，当输入未变化时，已保存的路由决策会在恢复时复用。只读 API 令牌可以调查，但不能创建定义或更改记录。
- **Proposals**（`/proposals`）是助手生成的待发布定义等待审核的地方。引导式设置会自动发布其已确认本体的经过验证的构建结果。
- **Settings** 包含 **AI & models**（选择 Local、Claude 或 OpenAI 并输入 API 密钥）和 **Developer tools**（API 令牌）。其他 AI 设置通过 API 设置；请参阅 [AI 与审核](#ai-与审核)。

## 引导式设置与示例数据

当工作空间设置未完成时，打开应用会直接进入设置。无需创建账户。设置包含三个步骤。

1. **AI。** 选择 **Local**（默认，使用 `qwen3:4b`）、**Claude** 或 **OpenAI**。Claude 和 OpenAI 需要 API 密钥，其默认模型为 `claude-sonnet-4-6` 和 `gpt-5.4-mini`。**Continue** 会直接打开 Data 步骤，并在后台准备提供方。对于 Local，应用会检查发布版本固定的模型，如果缺失则通过 Ollama 下载，验证其摘要并测试结构化输出。如果准备失败，后续步骤会显示错误，并提供 **Retry AI connection** 和 **Change AI choice**。没有 AI 设置也能正常工作；AI 只是添加描述。
2. **Data。** 连接你的数据源并让其完全导入，或选择 **Continue with sample data**。不会自动填充任何种子数据。
3. **Ontology。** Helix Foundry 从数据中计算建议的本体：通过匹配键跨数据源合并的实体，以及它们之间的链接。建议是确定性的。当 AI 就绪时，后台运行只会重写其摘要、描述和链接名称。重命名或排除实体，然后点击 **Looks right — build my workspace**。构建以代码方式运行，不调用模型，以简单的阶段显示进度，并发布工作空间。随后 Home 会打开并显示键指标。

进度保存在服务器上。如果你关闭浏览器，后台工作会继续，重新打开应用会回到同一步骤。

**示例数据** 模拟了 Loopwell——一家虚构的 B2B 反馈与路线图 SaaS 公司——从 PlanetScale、WorkOS、PostHog、Stripe 和 S3 存储桶连接时的样子。它包含 11 个相互关联的数据集，其中相同的客户出现在每个系统中，并带有需要协调到同一本体的真实差异：与登录邮箱不同的账单邮箱、没有账户的帮助台请求，以及拼写错误的营销活动代码。数据集包括 PlanetScale 的 accounts 和 users；WorkOS 的 organizations、users 和 SSO connections；PostHog 的 events；Stripe 的 customers、subscriptions 和 invoices；以及来自 S3 的 `support_tickets.csv` 和 `marketing_campaigns.csv`。示例在你的计算机上生成，因此不会下载任何内容。

[入门说明](onboarding.md) 列出了入门 API 路由、SDK 方法和导入限制。

## 连接数据源

选择 **Data → Add data**，输入凭据，点击 **Test connection**，选择表或 S3 文件，然后连接。你可以在一次连接中选择多个表或文件，最多 100 个。每个选择都保留自己的源记录和完整快照。导入必须在限制内完全完成：两百万条流式记录、1,000 个 REST 页面和每次上传 256 MB。

### 托管数据库：Neon、Supabase 和 PlanetScale

首先选择数据库的托管位置。提供方登录需要先注册 OAuth 集成。如果没有，可使用 Neon API 密钥、Supabase 个人访问令牌或 PlanetScale 服务令牌。在你选择表时，数据库凭据保留在服务器上。直接连接和其他数据源类型仍然可用。配置和提供方特定要求请参阅[托管集成设置](HOSTING.md)。

### PostgreSQL 和 MySQL

**PostgreSQL** 接受单个掩码连接 URL，包括其数据库用户名和密码；也可使用单独的字段。导入使用只读快照事务和服务器游标。

**MySQL** 支持可配置的、经过验证的 TLS 和自定义 CA。大整数和小数保留为字符串，时间戳读取为字符串。转换可以显式地对其进行类型转换。

### Stripe

Stripe 需要具有读取权限的受限 API 密钥。**Test connection** 列出该密钥可读取的对象：customers、products、prices、coupons、promotion codes、subscriptions 及其 items、invoices 及其 line items、charges、payment intents、refunds、disputes、payouts 和 balance transactions。每个选中的对象成为自己的数据集。

ID 会重命名为 `<object>_id` 列（例如 `customer_id`），诸如 `customer` 的引用会变为匹配的 `_id` 列，Unix 时间戳会变为 ISO 时间戳，因此关系可在各对象间对齐。诸如 `metadata` 的嵌套字段保留为 JSON。Stripe 导入是完整快照，默认每小时刷新一次。

### WorkOS

WorkOS 需要用于导入环境的 API 密钥。它提供 organizations、users、organization memberships、invitations、SSO connections、directories、directory users、directory groups 和 directory group members。ID 会重命名为 `<object>_id` 列；现有的 `organization_id`、`user_id` 和 `directory_id` 引用已经匹配。WorkOS 要求过滤的列表会按组织、目录或组获取。

### PostHog

PostHog 需要具有 Query Read 和 Project Read 权限的个人 API 密钥，以及美国、欧盟或自托管区域。它提供 persons（从 properties 中提取 `email`）、person distinct IDs、groups、events，以及每人每日事件计数。

事件和每日计数默认覆盖最近 30 天（最多 365 天）。它们按 UTC 日逐日读取，使用键集分页的 SQL 查询。已识别用户携带你应用的用户 ID 作为 distinct ID，因此 `person_distinct_ids` 是 PostHog 人员与你用户关联的方式。PostHog 默认每六小时刷新一次。

Stripe、WorkOS 和 PostHog 出现在 **Add data** 中数据库主机的旁边。

### REST API、文件、S3 和摄取 API

- **REST** 支持无分页、next-link、cursor 和 offset 响应。设置 items 路径和分页字段以匹配 API。
- **S3 兼容存储** 从存储桶导入选定的文件。
- **上传** 接受最大 256 MB 的 CSV、JSON、JSONL 和 Parquet 文件。每次上传成为一个持久化后台任务，你可以一起选择多个文件。
- **摄取 API**（`POST /api/v1/workspaces/:w/ingest`）每次请求最多接受 10,000 行。摄取会替换完整快照；它不是追加 API。

### 同步与变更捕获

数据库导入会自动尝试 PostgreSQL 逻辑复制或 MySQL 行 binlog 捕获。在允许的情况下，Foundry 会创建自己的 PostgreSQL publication 和 slot，且从不修改服务器级设置。原生变更捕获将已提交的变更合并为完整的、有界内存的快照导入，包括更新、删除和截断。本版本尚未直接应用行增量，因此大型或快速变化的表在物化期间可能会滞后。

如果复制不可用，快照每五分钟刷新一次（或按通过 API 设置的现有 UTC 计划），并显示可见原因和自动重试。REST 和 S3 数据源也使用快照刷新；上传保持显式。设置的工作空间构建所读取的数据源的自动刷新会等待构建完成，最长 15 分钟。Schema 变更会暂存以供审核。业务记录覆盖和发布保护保持独立。尚不支持写回数据源、逐行 AI 增强和分布式计算。

[运维文档](OPERATIONS.md) 列出了变更捕获所需的数据库权限，以及如何管理 WAL 和 binlog 保留。

## AI 与审核

**提供方。** 通过 Ollama 的本地推理是默认选项。Claude 和 OpenAI 是显式选择，且提供方之间没有回退。托管密钥在浏览器中输入、加密，并在激活提供方前进行测试。如果替换提供方未通过测试，现有设置保持激活。

**上下文与隐私。** AI 看到有界的 Schema、画像和样本上下文。发送给托管提供方的样本会屏蔽检测到的敏感列，除非在提供方设置中将 `allowRawData` 设为 `true`（仅 API 设置，默认关闭）。检测是启发式的，因此在使用托管提供方前请审查你的数据源策略。

**限制。** 本地 worker 调用一次运行一个，每个失败的资产组有两次修复尝试。预算通过 API 设置，使用 `PUT /api/v1/workspaces/:w/provider`（仅所有者）。发送 `provider` 和 `model` 以及预算：省略的字段会恢复默认值，当提供方不变时保留已保存的 API 密钥，设置会在保存前进行测试。

- `maxCalls`：每次运行的模型调用次数，1 到 20，默认 20。每次运行重试都会获得新的调用预算。
- `timeoutSeconds`：每次运行的时间预算和每次模型调用的超时，30 到 1,800 秒，默认 600。
- `dailyTokens`：每个工作空间每个 UTC 日的令牌数，1,000 到 10,000,000，默认 200,000。

**免提语音。** 使用 OpenAI 提供方，且项目可访问 GPT-Live（`gpt-live-1`）时，Home 上 Ask 框之后和聊天输入框上方会出现一个小蓝色圆球。按下它会请求麦克风并开始语音对话；会话连接期间圆球会发光。GPT-Live 主持对话，并将业务问题交给 Foundry，Foundry 在同一聊天中用普通的只读 Analyst 运行回答每个问题，因此表格、图表和数据源照常出现。GPT-Live 随后朗读经过验证的结果；它被指示绝不说出后端未返回的工作空间数字。后续追问无需按 Send 即可继续，在聊天内启动语音会保留该聊天的上下文。输入会暂停麦克风，直到文本发送或清除。按下圆球或 Escape、说出你想停止，或离开聊天即可结束语音。语音从不构建或更改任何内容。单行答案会连同其数字一起朗读；表格会得到一句话的标题并留在聊天中。语音仅在 OpenAI 提供方下可用，它会将每个答案发送给 OpenAI 以便朗读；设置的 OpenAI 卡片说明了这一点。OpenAI 密钥保留在服务器上，服务器创建每个会话并通过服务器端 WebSocket 控制它。语音由 OpenAI 按会话秒数计费，外加解释每个语音请求的模型调用。

**验证。** 模型生成的定义会进行 Schema 检查并针对数据执行。通过语法和质量检查并不证明业务含义，因此提案会显示其假设和未匹配的关系以供审核。引导式设置只发布通过验证的内容，基于你确认的本体构建。模型质量和延迟取决于你的硬件和所选模型。默认 Qwen 摘要记录在 [`models.json`](models.json) 中，安装会在激活前验证它。

**发布与回滚。** 发布检查确切的提案哈希和输入版本，然后切换代际。每个对象类型和关系是一个执行器查询，worker 读取其行并分批暂存；记录数与快照不同的类型会停止发布，上一代际保持激活。重新验证会创建一个新的可审核提案。回滚会针对当前快照重新验证并重新物化之前的定义，同时保留手动操作及其审计历史。失败的暂存产物可在离线维护期间移除，前提是检查确认没有发布引用它们。

## 架构

| 服务     | 职责                                                                |
| -------- | ----------------------------------------------------------------------------- |
| App      | React UI、仅回环 API、API 令牌检查、发布和操作        |
| Worker   | 持久化 AI 运行、定时导入、流水线执行、主动提案   |
| Executor | 一次性 DuckDB 子进程、声明的输入、隔离的 SELECT 执行 |
| HelixDB  | 工作空间元数据、API 令牌、任务、提案、本体记录和边   |
| Ollama   | 带持久化模型存储的本地结构化推理                      |

在 Docker Compose 中，worker 作为自己的服务运行。在开发环境（`pnpm dev`）中，它运行在 API 进程内。只有 app 发布端口，位于 `127.0.0.1`。执行器单独位于没有外部访问的内部网络上。

数据存储在三个 Docker 卷中：

| 卷                       | 内容                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `helix-foundry_helix-data`   | HelixDB 元数据：工作空间、本体、任务、API 令牌和加密凭据                                                                      |
| `helix-foundry_foundry-data` | Parquet 快照、构建产物和暂存上传；还包括执行器的溢出文件（`scratch`）和发布文件（`results`），备份会排除它们 |
| `helix-foundry_model-data`   | Ollama 模型权重（不备份；可重新下载）                                                                                      |

**HelixDB。** 查询使用 HelixDB TypeScript SDK 3.2 和 `/v2/query`。作用域修订在每个写入批次内比较并推进，因此过期的元数据写入会作为一个整体失败。数据集构建产物和暂存的本体代际在发布指针变化前保持不可见。数据源导入与手动对象覆盖层保持独立。

**执行器隔离。** 执行器加载已批准的输入快照，禁用外部访问和扩展安装，锁定其配置，并将生成的 SQL 包装为单个 SELECT。它没有连接器或 API 凭据。同时运行两个 DuckDB 任务，每个有 512 MB