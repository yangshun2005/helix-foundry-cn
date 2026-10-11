# 数据库托管集成

数据步骤从 Neon、Supabase 和 PlanetScale 开始。选择一个托管服务，连接账户，选择数据库或分支，然后预览并选择表。只有选中的表会被导入。直接 PostgreSQL/MySQL 连接、文件、REST、blob 存储和摄取 API 直接显示在托管服务下方，用分隔线隔开。

提供商登录需要先注册一个 OAuth 集成。如果没有注册，Neon 接受 API 密钥，Supabase 接受个人访问令牌，PlanetScale 接受服务令牌 ID 和令牌。每个对话框都包含一个令牌设置链接和一个 **连接账户** 按钮。三者也都提供直接数据库连接。提供商令牌不同于数据库密码或 Supabase 项目的 anon/service-role 密钥。

## 安装

使用 `.env.example` 中的变量设置提供商的客户端 ID 和密钥：`NEON_CLIENT_ID`、`NEON_CLIENT_SECRET`、`SUPABASE_CLIENT_ID`、`SUPABASE_CLIENT_SECRET`、`PLANETSCALE_CLIENT_ID` 和 `PLANETSCALE_CLIENT_SECRET`。Compose 仅将这些传递给应用。切勿将它们放入前端代码中。

使用此计算机上的浏览器源（开发环境中为 `APP_ORIGIN`，Compose 中为 `PUBLIC_ORIGIN`；默认为 `http://localhost:3001`）为每个工作区注册精确的回调：

```text
http://localhost:3001/api/v1/workspaces/WORKSPACE_ID/hosting/neon/callback
http://localhost:3001/api/v1/workspaces/WORKSPACE_ID/hosting/supabase/callback
http://localhost:3001/api/v1/workspaces/WORKSPACE_ID/hosting/planetscale/callback
```

当前回调是特定于工作区的，因此需要为新工作区添加回调。本地开发使用 `http://localhost:5173`。提供商必须允许 `localhost` 回调；Foundry 没有登录功能，且不得暴露到网络以获取公共回调 URL。更改凭据后重启应用。对话框将提供 **继续使用…**。在依赖之前，请检查真实的授权和导入；模拟的协议测试无法确立提供商批准或实时连接。

## 提供商

- **Neon：** [OAuth 文档](https://neon.com/docs/guides/oauth-integration)。OAuth 需要经过批准的商业合作伙伴关系。Foundry 请求项目读取和离线刷新范围；API 密钥是替代方案。选择项目、分支和数据库。Foundry 检索现有数据库所有者的连接 URI，而不创建或重置角色。对于单独配置的限制角色，请使用直接连接。
- **Supabase：** [OAuth 文档](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration) 和 [范围](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration/oauth-scopes)。配置项目和数据库配置读取访问权限。个人访问令牌是替代方案。选择项目并输入其数据库密码，Management API 无法检索该密码。Foundry 使用直接 PostgreSQL 主机。如果其 IPv6 端点不可达，请改用可达的直接/连接池 URL。
- **PlanetScale：** [OAuth 文档](https://planetscale.com/docs/api/planetscale-api-oauth-applications)。为你的引擎启用组织/数据库/分支列表和凭据创建，包括适用时的只读生产密码访问。选择组织、数据库和分支。Foundry 为 Vitess/MySQL 创建读取者密码，或为 PostgreSQL 创建一个继承 `pg_read_all_data` 且无复制权限的角色，命名为 `Helix Foundry …`。

提供商登录仅从浏览器中的应用发起，只读 API 令牌无法连接提供商账户。已授权的选择会在服务端重新检查，凭据在服务端保持加密。浏览器接收发现结果和一个不透明的工作区范围连接引用。之后应用现有的完整导入、Schema 审查和自动同步。提供商登录不授予复制权限；当 CDC 不可用时，受限凭据可以使用现有的快照回退方案。

## 恢复与安全

对于没有 OAuth 的 PlanetScale，在 **设置 → 服务令牌** 中创建服务令牌，将其 ID 和令牌复制到 Foundry，并仅为你打算导入的数据库授予权限。Foundry 在存储令牌之前通过列出其组织来验证令牌。它使用 PlanetScale 的 `ID:TOKEN` 授权方案，而非 bearer 令牌。组织和数据库选择在每一步都会根据该令牌的授权资源进行检查。参见 [服务令牌](https://planetscale.com/docs/api/service-tokens)。

授予数据库/分支读取访问权限以及创建连接凭据的权限：Vitess/MySQL 对开发分支使用 `connect_branch`，对生产使用 `connect_production_read_only_branch`；PostgreSQL 使用 `create_branch_password` 或 `create_production_read_only_branch_password`。Foundry 请求读取者凭据。更广泛的令牌管理或源数据写入权限是不必要的。已撤销的令牌可以使用 **连接另一个账户** 来替换。SDK 在现有的 Neon/Supabase 方法之外还暴露了 `hostingServiceToken({ serviceTokenId, serviceToken })`。

OAuth 状态在十分钟后过期且为一次性使用，绑定到浏览器、本地会话和工作区。Neon 和 Supabase 使用 PKCE。令牌和数据库凭据被排除在公共资源检索和 AI 上下文之外。请求日志省略回调查询字符串。账户列表是分页且有界的；过大的账户会收到明确的直接连接回退方案，而不是静默地返回不完整结果。

准备好的凭据在发现之前被持久化，以便发现重试时复用它们。中断的 PlanetScale 凭据创建响应可能会留下未使用的远程凭据；请在其控制台中撤销未使用的 `Helix Foundry …` 凭据。从设置中移除源不会撤销提供商访问权限。在停用连接时，请在提供商处撤销它，同时保留其他源仍需要的凭据。

中断、撤销的访问权限和私有网络可能会阻止连接。修复访问权限后重试、重新连接，或使用直接 URL。Foundry 不会重置数据库密码、修改服务器范围的网络设置，或自动切换托管提供商。

`tests/hosting.test.ts` 覆盖了模拟协议、浏览器绑定、加密持久化和刷新、只读令牌和仅浏览器限制、工作区隔离、选定资源检查、读取者凭据请求以及分页。实时检查需要已配置的集成和可访问的测试数据库。