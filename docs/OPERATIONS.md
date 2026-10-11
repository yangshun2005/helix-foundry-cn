# 运维 Helix Foundry

## 安装配置

`./scripts/setup.sh --compose` 启动本地模型配置并下载经过测试的 Qwen3 4B 模型。应用可通过 `http://localhost:3001` 访问。在 Apple Silicon 上，原生 Ollama 可以使用 Metal：在不带 `--profile local` 的情况下运行数据服务，并在 `.env` 中设置 `MODEL_ENDPOINT=http://host.docker.internal:11434`。

请将 `.env`、数据卷和备份保持私密。应用使用 `ENCRYPTION_KEY` 加密连接器/提供商凭据；丢失该密钥将导致这些凭据无法恢复，且备份中不包含该密钥。不要通过简单地替换环境变量值来轮换它。Helix Foundry 没有登录功能，因此不要允许其他设备接入。除非设置 `ALLOW_NETWORK_ACCESS=true`，否则 API 会拒绝非回环地址的 `HOST`；Compose 设置了该变量，因为它仅将应用发布到 `127.0.0.1`。不要通过反向代理、隧道或端口转发将其暴露到网络。Compose 不会发布内部 HelixDB、Ollama 和执行器端口。

## 诊断与 Schema 迁移

`pnpm doctor` 检查数据库、执行器、模型端点和本地密钥。`/api/health` 是进程健康检查。启动时会幂等地应用带索引的 version-1 元数据 Schema；`node --import tsx scripts/migrate.ts` 会显式应用它。启动时会拒绝比应用更新的数据库 Schema 版本。

作业会申请租约并定期续约。Worker 重启会回收过期的租约。当基于已确认本体（ontology）的构建在排队或运行期间——包括重启后的 Worker 等待其租约过期期间——其数据集所读取的源的定时同步和 CDC 同步会保持排队，以便构建发布它所验证的输入版本。每次同步从入队起最多等待 15 分钟，无论 Worker 重启多少次，因此缓慢或崩溃的构建无法将源的数据阻塞更长时间。当该时间到期时仍在运行的构建因此可能失败：同步会运行，而当构建发布时，它会以 "Inputs changed during publication" 停止，或者如果同步在构建验证其输入之后、发布开始之前完成，则以 "Input data changed. Revalidate this proposal." 停止。不会发布任何内容，工作区保持原样。使用 setup 中的 **Retry** 重试构建：它会基于新数据重新构建、验证并发布。其他源的同步照常运行，手动同步某个源会像手动同步一样启动其等待中的同步。其他构建（聊天请求、持续修复以及基于目标的 setup）以提案形式结束以供审核，而不是直接发布，因此它们不持有同步；输入被同步更改的提案必须在发布前重新验证。AI 阶段在每次完成的阶段后保存定义和用量；失败/取消的运行可以通过 Activity 或 API 恢复。输入更改会使缓存的阶段失效。失败的连接器/流水线作业会以有界退避重试三次。停止的 Worker 不会停止已发布的仪表板查询。

## 变更捕获

数据库同步优先使用原生 CDC。PostgreSQL 需要逻辑 WAL、具备复制能力的登录、主键/可用的副本标识、表发布权限以及可用的复制槽。Foundry 会为每个选定的表创建限定范围的发布和槽。MySQL 需要行格式的二进制日志、SELECT 访问权限以及复制客户端/从库权限。只读登录仍可通过定时回退方式导入。Foundry 从不更改服务器范围的数据库配置，也不会将业务记录写回源。

捕获服务独立于推理运行，将其脏计数器（dirty counter）和日志位置原子性地保存在 HelixDB 中，并且仅在该持久化写入之后才向 PostgreSQL 确认。一个排队的快照会合并多个提交；其起始计数器可防止并发更改被意外标记为已应用。在导入期间，现有的完整快照保持可用。重新连接会协调新快照，包括在恢复旧元数据之后；Schema 更改仍需审核。瞬时流故障会从保存的位置重试，然后回退到定时刷新。这是带完整快照物化的原生日志捕获，而非逐行复制：现有的两百万行导入和执行器限制仍然适用。

监控源端的 WAL/binlog 磁盘保留情况。为安装配置 PostgreSQL 的 `max_slot_wal_keep_size` 和合适的 MySQL binlog 过期策略；应用不会更改这两个服务器设置。在手动移除 Foundry 拥有的槽/发布之前，请先停止捕获。在停用源或更改其端点时，请从源的同步元数据中保留其名称。不要删除其他应用的复制资源。

## 备份、恢复与升级

备份不包含 `ENCRYPTION_KEY` 或 `INTERNAL_KEY`。请单独保存一份 `.env` 副本，例如放在密码管理器中；没有它，恢复的安装将无法解密其连接器和 AI 凭据。

由旧版 `backup.sh` 创建的备份确实包含它们：它会将 `.env` 作为 `config.env` 复制到每个备份中，两个密钥均为明文，默认放在仓库的 `backups/` 文件夹中，旧文档建议使用 `~/helix-foundry-backups/`。任何拥有副本的人都可以解密所有存储的凭据。`backup.sh` 和 `upgrade.sh` 会列出它们在这两个文件夹中找到的备份。一旦你有了新备份和单独的 `.env` 副本，请删除那些旧备份，或至少删除其中的 `config.env`，以及它们在其他地方的任何副本。没有 `config.env` 的旧备份仍可通过 `--env-file` 或 `--accept-key-mismatch` 恢复。

1. 使用仓库外的新文件夹运行 `./scripts/backup.sh PATH`（默认为 `~/helix-foundry-backups/TIME`）。它会停止写入者和 HelixDB，归档数据卷（不含执行器的临时 `scratch` 和 `results` 文件夹），重新启动之前正在运行的服务，并检查归档能否读回。它会写入 `settings.env`（包含非机密的 `.env` 行，包括任何执行器限制）和 `manifest.txt`（包含服务运行的提交、其 HelixDB 镜像和元数据 Schema 版本、HelixDB 容器的镜像以及 `ENCRYPTION_KEY` 的指纹）。退出状态 3 表示备份已完成但服务未能重新启动。任何其他失败都不会留下备份：它会移除所写入的所有内容，如果文件夹是它创建的则一并移除，重新启动它停止的服务，并在服务未能启动时说明。指纹是密钥的 SHA-256 加上固定前缀，因此它能在不泄露密钥的情况下标识密钥。每个文件仅你本人可读。它还会在备份中保存一份 `restore.sh` 和 `backup-lib.sh` 的副本，这样旧版本的检出（其自身的 `scripts/restore.sh` 无法读取此格式）仍可恢复它：从仓库根目录运行 `bash BACKUP/restore.sh BACKUP --replace`。
2. 要将密钥与备份一起保存，请运行 `./scripts/backup.sh --include-key PATH`。它会将整个 `.env` 存储为 `env.enc`，使用 AES-256-CBC 加密，密钥由你的口令通过 PBKDF2-SHA256（600,000 次迭代）派生。在提示时输入口令，或设置 `BACKUP_PASSPHRASE`；切勿将其放在命令行上。任何拥有备份和口令的人都可以解密所有存储的凭据。
3. 将备份复制到私密的异地存储。
4. 要恢复，请运行 `./scripts/restore.sh PATH --replace`。它会在停止任何内容之前检查备份，包括两个归档能否读回。如果 `.env` 的密钥与备份的指纹匹配，则保留它。否则它会依次使用 `--env-file FILE`（你的 `.env` 副本）、`env.enc`，然后是 `config.env`（此格式之前的备份所持有的，密钥为明文）；恢复时会对此发出警告。`--env-file` 只读取文件一次，因此它可以直接通过进程替换从密码管理器的命令行工具读取，`--env-file <(COMMAND)`，而无需在磁盘上保留明文副本。它会拒绝不匹配的密钥。`--accept-key-mismatch` 仍会恢复数据，如果你传入 `--env-file` 则使用其中的密钥（随后会替换 `.env`），否则使用当前的 `.env`，即使备份中有 `env.enc`。这样存储的凭据将无法解密，因此你需要重新输入它们。你已删除其 `config.env` 的旧备份不会记录其密钥，因此需要 `--env-file` 或 `--accept-key-mismatch`，恢复时会警告无法检查密钥。它还会拒绝以更新的 HelixDB 存储格式写入的备份，或元数据 Schema 比检出更新的备份，并指出要检出的提交。如果备份或检出指定的 HelixDB 镜像没有版本，它无法比较它们，除非你传入 `--accept-helix-mismatch`，否则会拒绝；该选项也会覆盖存储格式检查；HelixDB 随后可能会拒绝数据。然后它会替换两个数据卷，之后才替换 `.env`，将旧的保存为 `.env.pre-restore-TIME`；它持有旧密钥，因此在确认恢复后请删除它。它会使 `.env` 仅你本人可读。最后，它会重新构建并启动服务。如果某一步失败，它会说明所留下的状态，再次运行它会完成恢复。
5. 项目名称会作为卷名称的前缀。脚本会像 Compose 一样查找它：先来自 shell 的 `COMPOSE_PROJECT_NAME`，然后来自 `.env`，然后来自 `compose.yaml` 中的 `name:`（`helix-foundry`）。如果你在 shell 中设置它，请为每次备份、恢复和升级设置相同的名称。`restore.sh` 会拒绝指定了与当前项目不同的项目的 `.env`。
6. 使用 `./scripts/upgrade.sh` 升级。备份是其第一步，无法跳过：它会获取上游分支，进行全新备份（`--backup-dir DIR` 选择文件夹，`--include-key` 透传），检查它，如果备份失败则不做任何更改并停止。它会在备份的 `manifest.txt` 和 `upgrade.txt` 中记录先前的提交和 HelixDB 镜像，进行快进，并使用 `docker compose up -d --build` 重新构建和重启。它会在 git 目录中记录服务运行的提交（`helix-foundry-deployed`）。在重新构建成功之前，它还会在那里保留未完成的升级（`helix-foundry-upgrade`），因此如果重新构建失败，下次运行会完成升级：它会再进行一次备份，再次询问 HelixDB 更改，并指出第一次尝试之前的备份以供回退，因为 HelixDB 可能已经用新镜像打开了数据。如果没有运行提交的记录，例如手动 `git pull` 之后，它仍会备份并重新构建，但无法指出要回退到的提交；`git reflog` 会显示它。之后，在再次使用安装之前，请运行诊断、样本摄取、保存的查询和提案验证。`upgrade.sh` 之前的检出可通过一次 `git pull --ff-only` 获取它，无需重新构建；然后运行 `./scripts/upgrade.sh`。在该 pull 之前，如果自上次启动堆栈以来检出未被 pull，请使用 `git rev-parse HEAD > "$(git rev-parse --git-path helix-foundry-deployed)"` 记录运行提交，以便备份和回退建议能指出它。
7. HelixDB 升级是单向的。HelixDB v0.0.10 或更高版本首次打开数据库时会升级索引存储，v0.0.9 及更早版本随后会以 `unsupported_index_storage_version` 拒绝它。当某个发布版本更改了 `compose.yaml` 中固定的 HelixDB 镜像时，`upgrade.sh` 会打印警告并在备份和新镜像之前等待 `yes`（或 `--yes`）；它会拒绝将 HelixDB 移回旧版本的发布。要还原升级，请从仓库根目录运行 `upgrade.sh` 打印的两条命令：`git reset --keep PREVIOUS_COMMIT`（保留分支，以便下次 `upgrade.sh` 再次快进），然后使用升级前所做的备份运行 `bash BACKUP/restore.sh BACKUP --replace`。那是备份中保存的 `restore.sh` 副本：重置后，`scripts/restore.sh` 是旧版本的，而 `upgrade.sh` 之前的版本需要 `config.env`，备份已不再持有它。

模型权重是可复现的，不包含在应用备份中。Parquet 版本和暂存产物是不可变的；不成功的预览会消耗磁盘。发布时，执行器会将每个对象类型和关系的行写入 `DATA_DIR/results` 中的一个文件，并在读取后删除该文件，因此每次发布同一时间只存在一个文件。这些文件是未压缩的 JSON lines，通常比数据集的 Parquet 快照大数倍，并受 `EXECUTOR_RESULT_LIMIT` 限制（参见[部署限制](#deployment-limits)）。停止的发布会留下其文件；Worker 在启动时以及每十分钟会移除那里超过十分钟的文件。备份会排除 `results` 和执行器的 `scratch`，它们不包含恢复的安装所需的任何内容。此 MVP 中没有自动的产物垃圾回收器。仅在离线维护期间，在检查提案/运行预览和版本记录后，移除未被引用的文件。

## 部署限制

同时执行两个 DuckDB 作业，最多还有 50 个等待轮次。每个作业有 512 MB 的每进程内存设置（`DUCKDB_MEMORY`）和一个时间限制，从执行器收到它时开始计算，因此包括等待轮次所花费的时间：

- `EXECUTOR_QUERY_TIMEOUT`（默认 120 秒）用于查询：仪表板、保存的查询、问题以及构建对其组件和关系的检查。
- `EXECUTOR_JOB_TIMEOUT`（默认 900 秒，即 15 分钟）用于导入、流水线和发布查询，这些会读取或写入整张表。

两者都接受从 1 到 86400（一天）的整数或小数秒，不带单位，例如 `1800` 或 `90.5`。API、Worker 和执行器在启动时会检查它们，并拒绝以任何其他值启动，例如 `2m` 或 `100000`，并显示 "Invalid EXECUTOR_JOB_TIMEOUT: 2m (whole or decimal seconds, from 1 to 86400)"。在 Compose 中，Docker 随后会不断重启它们，健康检查会失败，直到该值被修复。

超时的作业会以 "Stopped at the executor's time limit" 停止，并指出该设置。在等待时超时的作业永远不会运行，并以 "The executor was busy with other jobs" 失败。API 读取相同的设置并多等待 15 秒，因此它总能收到执行器的答复；Compose 和 `pnpm dev` 都会将 `.env` 中的值提供给两者。

需要更多内存的作业会溢出到 `DATA_DIR/scratch`。Foundry 默认对此不设限制。DuckDB 随后会停止其溢出文件将超过可用磁盘空间 90% 的作业，但该界限仅单独适用于每个作业：两个大作业同时运行，或一个作业与其他对数据卷的写入同时进行，仍可能填满磁盘。导入大文件会加载整张表并分析每一列，可能溢出为文件 Parquet 大小的数倍。`DUCKDB_SPILL_LIMIT` 限制每个作业的溢出文件，为带单位的大小，例如 `20GB` 或 `20GiB`。需要更多空间的作业会以 DuckDB 的 "Out of Memory Error" 失败，并指出 `max_temp_directory_size` 设置；提高或移除该限制以导入它。没有限制时，同样的错误意味着作业的溢出文件达到了可用磁盘空间的 90%。设置了限制时，请为其保留两倍的可用空间用于溢出文件，因为两个作业可能同时溢出。

发布查询还会将其结果行以 JSON lines 写入作业的 scratch 目录，然后为 Worker 将它们移动到 `DATA_DIR/results`。它们不是溢出文件，因此 `DUCKDB_SPILL_LIMIT` 不计入它们；`EXECUTOR_RESULT_LIMIT`（默认 2 GB）限制每一个。更大的结果会使发布失败，并显示 "Result exceeds EXECUTOR_RESULT_LIMIT"。键在两侧匹配许多记录的关系是常见原因，但记录很多的类型也可能达到该限制；在 `.env` 中为一个提高限制。

其余部分没有任何限制：导入和流水线写入 `DATA_DIR/datasets` 的 Parquet 快照、暂存产物以及 HelixDB 自身的卷都会随你的数据增长。

每个作业的 scratch 目录在作业结束时被移除，包括因时间或输出限制被杀死，或因为执行器容器正在停止时。一旦开始监听，执行器还会移除启动时 `scratch` 中的作业目录，这会清除因内存不足被杀死而留下的溢出文件；无法监听的执行器（因为另一个执行器占用了端口）不会移除任何内容。`scratch` 中的其他内容不会被触碰。

在 Compose 中，请在 `.env` 中设置 `DUCKDB_SPILL_LIMIT`、`EXECUTOR_RESULT_LIMIT`、`EXECUTOR_QUERY_TIMEOUT` 和 `EXECUTOR_JOB_TIMEOUT`，并再次运行启动命令（`docker compose --profile local up -d`，或当堆栈不带该配置运行时去掉 `--profile local`）以应用它们；空值表示默认值。`pnpm dev` 也会从 `.env` 读取它们。执行器容器有 2 GB 内存上限和仅内部网络；其他服务参见[内存](#memory)。一个 Worker 一次执行一个推理作业。在此单服务器发布版本中使用一个 Worker 副本。

支持的运行时是 Node.js 24。没有账户：每个安装为其自己计算机上的一个人服务，该人拥有所有工作区。API 令牌是工作区范围的，可选只读，且可撤销。基准测试范围和未验证的部署组合参见 `VALIDATION.md`。

## 内存

HelixDB、捆绑的模型、应用、Worker 和执行器共享 Docker 的内存。Compose 为每个服务提供预算以及内核停止它们的顺序中的位置，以便在内存耗尽时模型或单个请求以错误失败，而 HelixDB 继续运行。

| 服务       |