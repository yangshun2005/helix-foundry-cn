# 开发者 API

所有路由均使用 `/api/v1`。没有账户或登录：不带 `Authorization` 头的请求以使用此计算机的人的身份执行，该人拥有所有工作区。脚本和 SDK 会发送 `Authorization: Bearer TOKEN`，其中 token 在 **设置 → 开发者工具** 中创建（POST `/workspaces/:workspaceId/tokens`，请求体为 `{ name, readOnly }`）。Token 作用域限定于某个工作区，可以是只读的，且不能创建工作区。无效或已撤销的 token，或非 Bearer 的 `Authorization` 头，会以 401 拒绝，而不会被当作本地用户处理。`Host` 头必须是回环名称或 `APP_ORIGIN` 主机，来自浏览器的变更请求必须带有配置的 `APP_ORIGIN` 或其回环等价地址。

工作区路由以 `/workspaces/:workspaceId` 开头。

每个领域拥有其下方的章节；请将新路由添加到自己的章节中。

### 共享（基础）

| 方法 / 路径                                            | 输入 / 结果                    |
| ----------------------------------------------------- | ------------------------------ |
| GET `/resources/:kind?offset=0&limit=100&search=term` | `{ items: Resource[], total }` |

### 工作区：主页、活动、评审、设置

| 方法 / 路径                                             | 输入 / 结果                                                                                                                                                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/overview`                                         | 工作区及当前目录、数据源、运行、提案、已发布资产                                                                                                                                                         |
| GET `/home`                                             | 工作区主页摘要：连接健康状态、流水线构建、未解决的发现、待处理评审、本体快照、最近活动、仪表盘                                                                                                           |
| GET `/activity`                                         | 活动流（作业、运行、编辑、发布），按最新优先排序；`kind`（逗号分隔：sync、upload、pipeline、model、job、run、setup、edit、publish）、`limit`（最大 200）、`offset`                                       |
| GET / PUT `/provider`                                   | 模型提供商设置；密钥永不返回                                                                                                                                                                             |
| GET `/events`                                           | 已认证的服务器发送事件：`{runs, jobs, reviews}`，包含活跃或最近 24 小时的运行和作业（仅 id、kind、name、时间及状态字段）以及待处理评审数量；在发生变化时发送                                                |
| PUT `/proposals/:id`                                    | 完整的 `Bundle`；创建并验证新提案                                                                                                                                                                        |
| POST `/proposals/:id/validate`                          | `{}`；创建一个新的已验证提案                                                                                                                                                                             |
| POST `/proposals/:id/publish`                           | `{ hash }`；原子性地发布已评审的 bundle                                                                                                                                                                  |
| POST `/proposals/:id/reject`                            | `{}`；拒绝未发布的提案                                                                                                                                                                                   |
| POST `/rollback`                                        | `{}`；重新验证并发布先前的定义，保留业务编辑                                                                                                                                                             |
| GET / POST `/definitions/export`, `/definitions/import` | 带版本的 bundle；导入会变为提案                                                                                                                                                                          |

### 数据

| 方法 / 路径                         | 输入 / 结果                                                             |
| ----------------------------------- | ----------------------------------------------------------------------- |
| POST `/ingest`                      | `{ name, rows: object[], datasetId? }`；每个请求最多 10,000 行          |
| POST `/upload`                      | 多部分文件；CSV、JSON、JSONL、Parquet；最大 256 MB                      |
| POST `/sources/test`                | `{ name, kind, config }`；发现和关键信息                                |
| POST `/sources`                     | `{ name, kind, config, schedule? }`；加密的数据源定义                   |
| POST `/sources/:id/sync`            | `{}`；持久化作业                                                        |
| POST `/datasets/:id/preview`        | `{ offset?, limit? }`；行和概要                                         |
| GET `/datasets/:id/export`          | 下载活跃的 Parquet 快照                                                 |
| PATCH `/datasets/:id`               | `{ description }`；保留手动编写的描述                                   |
| POST `/datasets/:id/accept-version` | `{}`；接受暂存的 schema 变更快照                                        |
| POST `/query`                       | `{ inputs: datasetId[], sql }`；只读结果和概要                          |

### 流水线

| 方法 / 路径               | 输入 / 结果                                                          |
| ------------------------- | -------------------------------------------------------------------- |
| POST `/pipelines/:id/run` | `{}`；持久化流水线作业                                               |
| POST `/pipelines/draft`   | `PipelineDefinition`；编译、执行并创建评审提案                       |

### 本体

| 方法 / 路径                    | 输入 / 结果                                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| POST `/actions/preview`        | `{ objectId, values }`；之前、之后和修订                                                                                          |
| POST `/actions/execute`        | `{ objectId, values, revision, idempotencyKey, revert? }`；审计事件                                                               |
| POST `/actions/change/preview` | `{ operation: 'create', objectType, values }` 或 `{ operation: 'link' \| 'unlink', name, from, to }`；受影响的记录和哈希          |
| POST `/actions/change/execute` | `{ action, hash, idempotencyKey }`；执行与预览完全一致的变更                                                                      |
| GET `/records/:logicalId`      | 当前代际记录，包含有效值、工作区编辑、相关记录和操作历史；跨发布保持稳定                                                          |
| GET `/objects/:id/neighbors`   | `{ ids }`；原生 Helix 图遍历                                                                                                      |

### 分析师

| 方法 / 路径                                         | 输入 / 结果                                                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| POST `/assistant/runs`                              | `{ goal, intent?: 'build' \| 'answer' \| 'auto', parentId?, context?: {page?,resourceId?} }`；持久化运行 |
| POST `/assistant/runs/:id/cancel`                   | `{}`；取消运行                                                                                            |
| POST `/assistant/runs/:id/resume`                   | `{}`；从已保存的阶段恢复中断的运行                                                                        |
| POST `/assistant/runs/:id/save-analysis`            | `{}`；从已执行的答案创建仪表盘提案                                                                        |
| GET `/live`                                         | `{ available, reason? }`；免提语音需要具有 GPT-Live（`gpt-live-1`）访问权限的 OpenAI 提供商               |
| POST `/live/sessions`                               | `{ sdp, chatId? }` → `{ sessionId, sdp, chatId }`；为浏览器启动 GPT-Live WebRTC 会话                      |
| POST `/live/sessions/:id/delegations/:delegationId` | `{}` → `{ status, action, question, runId, chatId }`；回答委派任务的分析师运行                            |
| POST `/live/sessions/:id/context`                   | `{ chatId?, typed? }`；会话切换到的聊天，或语音期间输入的问题                                             |
| GET `/live/sessions/:id`                            | 会话状态和每个委派任务的耗时（毫秒）：resolved、enqueued、finished、answerSent、answerDelivered           |
| DELETE `/live/sessions/:id`                         | 在浏览器关闭会话后释放服务器端资源                                                                        |

### 设置：托管提供商

| 方法 / 路径                         | 输入 / 结果                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| GET `/hosting`                      | 提供商可用性和已连接账户引用；无密钥                                                                                           |
| POST `/hosting/:provider/authorize` | `{ returnTo?: 'onboarding' \| 'sources' }`；OAuth URL；仅限浏览器，API token 会被拒绝                                           |
| GET `/hosting/:provider/callback`   | 单次使用的浏览器绑定 OAuth 回调                                                                                                |
| POST `/hosting/:provider/token`     | Neon/Supabase 使用 `{ apiKey }`，PlanetScale 使用 `{ serviceTokenId, serviceToken }`；验证并加密存储账户                          |
| POST `/hosting/:provider/options`   | `{ accountId, path: string[] }`；项目、数据库、分支或就绪状态                                                                  |
| POST `/hosting/:provider/connect`   | `{ accountId, path, password? }`；发现和不透明连接引用                                                                         |

MySQL 配置：`{ host, port:3306, database, user, password, table, tls, ca? }`。PostgreSQL 接受 `{ connectionString, schema?, table, tls?, ca? }` 或现有的独立连接字段。URL 凭据与连接器配置的其余部分一起加密。URL 模式默认使用已验证的 TLS；显式设置 `sslmode=disable` 或 `tls:false` 可禁用它。支持的 URL 选项有 `sslmode`、`ssl` 和 `application_name`；本地证书文件路径会被拒绝。REST 配置：`{ url, itemsPath?, token?, header?, pagination:'none'|'next'|'cursor'|'offset', nextPath?, cursorParam?, offsetParam?, limitParam?, pageSize? }`。S3 配置：`{ bucket, key, prefix?, region?, endpoint?, accessKeyId?, secretAccessKey? }`。

PostgreSQL/MySQL 导入作业会自动尝试原生 CDC。`source.data.sync` 暴露模式、状态、原因、最后捕获的事件以及变更/已应用计数器（共享包和 SDK 中的 `SourceSyncState`）。工作中的 CDC 会忽略 `schedule`；可选的 UTC 调度仅作为快照回退，默认为五分钟。REST/S3 使用快照刷新，因为这些连接器不暴露数据库日志。上传的文件和摄取请求仍然是显式输入。有关权限和物化限制，请参阅 `OPERATIONS.md`。

省略 `intent` 会保留 API 的 `build` 默认值。`auto` 会持久化一个有界的答案/构建路由阶段，并在现有预算中计入它。上下文 ID 在调用者的工作区内由服务器端解析；密钥和非活跃代际不会被接受。只读 token 可以提问，但路由到构建的请求会在生成之前停止。`resources/object` 支持 `type`、`search` 以及对有效工作区值的精确 `field`/`value` 过滤。仪表盘路由使用 `/dashboards/:encodedName`；记录路由使用 `/records/:logicalId`。

提案包含 `bundle`、`validation`、`hash` 和 `status`。验证报告包括已执行的检查、预览和确切的输入版本。将 HTTP 409 视为刷新/评审的请求；不要盲目重试发布或使用已更改载荷的操作。使用不同载荷重用操作键会被拒绝。

`Resource` 为 `{ id, workspaceId, kind, name, description, revision, createdAt, updatedAt, data }`。共享 schema 和类型位于 `packages/shared/src/index.ts`。`/api/docs` 处的交互式 OpenAPI 文档描述了正在运行的 API。

使用 `pnpm build:sdk`、`pnpm -C packages/shared pack` 和 `pnpm -C packages/sdk pack` 构建并打包两个工作区库。在客户端项目中安装生成的 tarball：

```ts
import { FoundryClient } from "@helix-foundry/sdk";

const foundry = new FoundryClient({
  baseUrl: "http://localhost:3001",
  workspaceId: process.env.FOUNDRY_WORKSPACE!,
  token: process.env.FOUNDRY_TOKEN!,
});

const dataset = await foundry.ingest("Orders", [
  { order_id: "o1", customer_id: "c1", amount: 42 },
]);
const run = await foundry.requestAssistance("Create a revenue dashboard", {
  resourceId: dataset.id,
});
// Use foundry.ask(question) or foundry.build(goal) for an explicit intent.
// Review the resulting proposal and its validation before calling publish().
```