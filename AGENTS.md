# Helix Foundry 代理运行手册

本运行手册面向编码代理（Claude Code、Codex、Cursor 等），当它们被要求在某人的计算机上搭建 Helix Foundry 或处理其代码时使用。用户应从 [README.md](README.md) 开始。

## 目标

使用 Docker Compose 安装并启动 Helix Foundry，验证其健康状态，并向用户提供一个可打开的 URL。当以下命令返回 `{"ok":true,"service":"helix-foundry"}` 时，任务完成：

```sh
curl -fsS http://localhost:<PORT>/api/health
```

除非你选择了其他端口，否则 `<PORT>` 为 3001。浏览器中的引导式设置（AI → 数据 → 本体）属于用户的操作，除非他们要求你完成其中一部分。

## 基本规则

- 从仓库根目录运行每一条命令。
- 在执行任何破坏性或干扰性操作之前先询问用户：删除容器、卷、镜像或文件，恢复备份，停止或终止不是你启动的进程，或安装软件。
- 切勿打印、`cat`、粘贴到聊天中或提交 `.env`、`.env.pre-restore-TIME` 文件、备份的 `env.enc` 或旧备份的 `config.env`。它们包含加密密钥。也不要索取、输入或存储备份口令：用户在自己的终端中输入。也不要使用编辑器或文件读取工具打开 `.env`，因为那会把密钥写入你的记录中。请使用本运行手册中的 `grep` 和 `sed` 命令，它们只更改或显示非机密的 `PUBLIC_PORT`、`PUBLIC_ORIGIN`、`MODEL_ENDPOINT` 和执行器限制行。也不要使用 `bash -x` 运行 `backup.sh`、`restore.sh` 或 `upgrade.sh`。它们会在处理密钥或口令的地方关闭跟踪，但跟踪记录最终会出现在你的记录中。
- 切勿删除、重新生成或覆盖现有的 `.env`。丢失 `ENCRYPTION_KEY` 会导致已存储的凭据无法恢复。
- 如果端口被占用，请选择其他端口。不要停止正在使用该端口的任何进程。
- 不要索取、输入或存储用户的 Claude 或 OpenAI 密钥或数据库密码。用户会在浏览器中输入它们。
- 未经询问不要安装软件（Docker、Ollama、Node、浏览器），并且绝不使用 `sudo`。
- Shell 变量通常不会在你的工具调用之间保留。下面每个需要应用端口的代码块都会再次从 `.env` 中读取它。切勿假设是 3001：其他程序或 Helix Foundry 的开发副本可能正在监听该端口。
- 重新运行这些步骤是安全的。`scripts/setup.sh` 绝不会覆盖现有的 `.env`，并且第 2 步会保留已在运行的安装的端口。

## 1. 获取代码

```sh
git clone https://github.com/helixdb/helix-foundry.git
cd helix-foundry
```

如果你已经在检出目录中（其中包含 `compose.yaml` 和 `scripts/setup.sh`），请跳过克隆。如果克隆失败并提示 "could not read Username"、"Repository not found" 或其他访问错误，请停止并询问用户正确的仓库 URL 或其副本的路径。

## 2. 预检

### Docker 和工具

```sh
docker version --format 'Docker {{.Server.Version}}'
docker compose version
git --version && openssl version && bash --version | head -n 1
```

- `docker: command not found`：未安装 Docker。停止并请用户安装 Docker Desktop，或带 Compose 插件的 Docker Engine。不要自行安装。
- "Cannot connect to the Docker daemon"：Docker 未运行。请用户启动 Docker Desktop 或 Docker 服务，然后重试。
- `docker.sock` 上的 "permission denied"（Linux）：用户账户无法使用 Docker。停止并请用户修复。切勿使用 `sudo` 重试。
- `docker compose version` 必须报告 v2。compose 文件需要 Compose v2 插件，而不是旧的 `docker-compose`。它已使用 v2.29 进行过测试。如果只有 `docker-compose`，请用户安装 Compose v2 插件。
- Docker 安装不需要 Node.js 和 pnpm。

### 现有安装

```sh
test -f .env && echo ".env exists" || echo "no .env yet"
docker volume ls --filter name=helix-foundry_ --format '{{.Name}}'
docker compose ls --all --filter name=helix-foundry
docker ps --filter label=com.docker.compose.project=helix-foundry \
  --filter label=com.docker.compose.service=app --format 'app running: {{.Status}} {{.Ports}}'
```

Compose 项目名称始终为 `helix-foundry`，无论从哪个文件夹运行，因此此计算机上的每个检出都共享相同的容器和卷。

| 你发现的情况                                                                                    | 含义及应对措施                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 没有 `.env`，没有 `helix-foundry_` 卷，没有项目                                                  | 全新安装。继续。                                                                                                                                                                                                                                                                                                                                                                              |
| `.env` 存在                                                                                     | 现有安装。保留 `.env` 及其设置，然后继续。`setup.sh` 不会动它。                                                                                                                                                                                                                                                                                                                                 |
| 没有 `.env`，但存在 `helix-foundry_helix-data` 或 `helix-foundry_foundry-data`                  | 停止并询问用户。该数据是用较早的 `.env` 中的密钥写入的。询问他们是否保留了该 `.env` 的副本（例如在密码管理器中），或者是否有带 `env.enc` 的备份或带 `config.env` 的较旧备份。新密钥会保留工作区，但会使其存储的凭据无法读取。（仅 `helix-foundry_model-data` 只包含模型权重，可以安全重用。） |
| 列出了一个 `helix-foundry` 项目，其 CONFIG FILES 路径不是此文件夹的 `compose.yaml`              | 停止并询问用户使用哪个检出。从此文件夹启动会接管并重新创建正在运行的容器，并使用此文件夹的 `.env` 来使用它们的卷。                                                                                                                                                                                                                                                                              |
| 打印了 `app running:` 且项目就是此文件夹                                                        | Helix Foundry 已在此处运行。保留其端口（`->` 前面的数字），跳过端口检查，然后从第 5 步继续。要升级，请使用 `scripts/upgrade.sh`（[运维](#operations)）。                                                                                                                                                                                                                                        |

如果 `.env` 存在，请在不打印它们的情况下检查其密钥是否已设置：

```sh
grep -Eq '^ENCRYPTION_KEY=.{32,}$' .env && grep -Eq '^INTERNAL_KEY=.{32,}$' .env \
  && echo "keys ok" || echo "keys missing or too short"
```

"keys missing or too short" 通常意味着 `.env` 是从 `.env.example` 复制来的。请参阅[故障排除](#troubleshooting)。

### 端口

Compose 仅发布应用，绑定在 `127.0.0.1` 上，默认端口为 3001（或 `.env` 中的 `PUBLIC_PORT`）。HelixDB、执行器和 Ollama 不发布端口，因此 6996、3002 或 11434 上的其他服务对 Docker 安装没有影响。

如果 Helix Foundry 已从此文件夹运行（见上文），请跳过此检查。否则将以下代码块作为一条命令运行。它先测试配置的端口，然后测试几个备选端口，还会查看其他容器占用的端口，这些端口在 Linux 上 `lsof` 在没有 root 权限时无法看到：

```sh
CONF=$(sed -n 's/^PUBLIC_PORT=//p' .env 2>/dev/null | tail -n 1); CONF=${CONF:-3001}
busy() {
  if command -v ss >/dev/null 2>&1; then [ -n "$(ss -ltnH "sport = :$1")" ] && return 0
  else lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1 && return 0; fi
  docker ps --format '{{.Ports}}' | grep -q ":$1->"
}
found=""
for p in "$CONF" 3005 3011 3021 3031 3041; do busy "$p" || { found=$p; break; }; done
if [ -z "$found" ]; then echo "No free port found: ask the user which port to use"
elif [ "$found" = "$CONF" ]; then echo "Port $CONF is free: keep it"
else echo "Port $CONF is busy: use $found"; fi
```

如果它打印 `use <port>`，请记住该数字以供第 3 步使用。

### 磁盘和内存

```sh
uname -sm
docker info --format 'Docker memory: {{.MemTotal}} bytes, CPUs: {{.NCPU}}'
df -h .
```

- 首次运行会下载数 GB 的数据：构建的应用镜像（约 0.9 GB）、HelixDB（约 160 MB）、Ollama 以及 `qwen3:4b` 模型（约 2.5 GB）。如果磁盘空间紧张，请在继续之前告知用户。
- 导入的数据随后会占用 Docker 卷中的磁盘空间，导入大文件时可能会短暂使用其大小的数倍：执行器会将内存中放不下的内容溢写到磁盘，默认情况下除了 DuckDB 自身的限制（每个作业可用磁盘空间的 90%）外没有其他限制。在 Docker Desktop 上，此空间是 Docker 的虚拟磁盘，在 设置 → 资源 下设置，而不是 `df` 显示的内容。如果用户打算导入数 GB 的文件，请在你的报告中说明。除非用户要求，否则不要设置 `DUCKDB_SPILL_LIMIT`：上限太小会导致大型导入失败（请参阅[执行器限制](#operations)）。
- 本地 AI 是在 16 GB 机器上开发和基准测试的，仅执行器就可能使用多达 2 GB。峰值内存尚未在 16 GB 或 8 GB 安装上得到认证。Compose 为服务提供了内存预算和终止顺序，捆绑模型在加载时使用约 3.3 GB（请参阅 [docs/OPERATIONS.md](docs/OPERATIONS.md#memory)）。使用 `MemTotal` 数值：
  - 低于 8000000000 字节：警告用户本地 AI 和大型工作区无法同时放入 Docker：问题可能会失败，数据库可能会重启。提供下面的路径 B 或 C。浏览器中的设置在选择 Local 时会显示相同的警告。
  - 从 8000000000 到 16000000000 字节：继续，并在报告中提及本地 AI 尚未在此内存大小下得到认证。
  - 高于 16000000000 字节：继续。

### 选择模型路径

| 路径                    | 何时使用                                                                                                             | 启动命令                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **A. Docker 中的 Ollama** | 默认，适用于任何操作系统。                                                                                          | `docker compose --profile local up -d --build`                  |
| **B. 原生 Ollama**      | 使用 Docker Desktop 的 macOS，当 Ollama 已在运行时。在 Apple Silicon 上更快，因为 Docker 无法使用 Metal。           | `docker compose up -d --build`，并在 `.env` 中设置 `MODEL_ENDPOINT` |
| **C. 仅托管 AI**        | 用户表示他们将使用 Claude 或 OpenAI，并希望跳过模型下载。                                                           | `docker compose up -d --build`，不设置 `MODEL_ENDPOINT`         |

按如下方式决定，并在报告中说明你使用了哪条路径：

```sh
uname -s
docker info --format '{{.OperatingSystem}}'
command -v ollama
curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:11434/api/tags && echo "Ollama is running"
```

- 仅当以下三个条件都满足时才使用**路径 B**：`uname -s` 打印 `Darwin`，Docker 报告 `Docker Desktop`，且 Ollama 正在运行。原生 Ollama 将模型保存在用户自己的 Ollama 中，如果缺少 `qwen3:4b`，应用会在那里下载它。
- 如果 Ollama 已安装但未运行，请询问用户是启动它（使用 Ollama 应用，或在他们同意的情况下使用 `open -a Ollama`）还是使用路径 A。不要从你自己的 shell 启动 `ollama serve`：它可能会在你的会话结束时停止，然后应用会在没有明显错误的情况下丢失其模型。
- 否则使用**路径 A**。这包括 Linux，其中 `compose.yaml` 没有 `host.docker.internal` 映射，以及其他 Docker 运行时，如 OrbStack 或 Colima，路径 B 在这些环境中未经测试。
- 仅当用户要求时才使用**路径 C**。
- 未经询问不要安装 Ollama。

在路径 C 上，在设置期间选择 Local 会失败并提示 "Local AI is unavailable. Start Ollama and retry."。这是预期行为。用户应改为选择 Claude 或 OpenAI。设置也可以在没有 AI 的情况下工作；AI 仅添加描述并选择 Home 的关键指标。

## 3. 创建并调整 `.env`

```sh
./scripts/setup.sh
```

首次运行时，它会打印 `Generated local secrets in .env`。它将 `ENCRYPTION_KEY` 和 `INTERNAL_KEY`（各 64 个十六进制字符）写入一个只有用户可读的文件。如果 `.env` 已存在，它不会做任何事。

不要先运行 `cp .env.example .env`。那样 `setup.sh` 会跳过密钥生成，Compose 会拒绝启动。

**其他端口。** 如果第 2 步打印了 `use <port>`，请将两行都设置为该端口。将第一行中的 `3005` 替换为该端口。该代码块会在这些行存在时更新它们，不存在时添加它们，不会打印密钥，也不会更改文件权限，并且可以安全地运行两次：

```sh
PORT=3005   # the port step 2 printed
tmp=$(mktemp .env.XXXXXX) && sed -e "s|^PUBLIC_PORT=.*|PUBLIC_PORT=$PORT|" \
  -e "s|^PUBLIC_ORIGIN=.*|PUBLIC_ORIGIN=http://localhost:$PORT|" .env > "$tmp" \
  && cat "$tmp" > .env && rm -f "$tmp"
grep -q '^PUBLIC_PORT=' .env || echo "PUBLIC_PORT=$PORT" >> .env
grep -q '^PUBLIC_ORIGIN=' .env || echo "PUBLIC_ORIGIN=http://localhost:$PORT" >> .env
grep -E '^PUBLIC_(PORT|ORIGIN)=' .env
```

最后一条命令只显示这两行，它们必须指定相同的端口。临时 `.env.XXXXXX` 文件匹配 `.gitignore` 和 `.dockerignore`。

**路径 B。** 将应用指向原生 Ollama：

```sh
grep -q '^MODEL_ENDPOINT=' .env || echo 'MODEL_ENDPOINT=http://host.docker.internal:11434' >> .env
```

**路径 A 和 C。** 确保未设置 `MODEL_ENDPOINT`，因为它会覆盖捆绑的 Ollama：

```sh
grep -E '^MODEL_ENDPOINT=' .env || echo "MODEL_ENDPOINT not set"
```

`setup.sh` 写入的其他行（`APP_ORIGIN`、`HELIX_URL`、`EXECUTOR_URL`、`OLLAMA_URL`、`DATA_DIR`）仅用于 `pnpm dev`。Compose 会忽略它们，因此不要动它们。

## 4. 启动堆栈

路径 A（与 `./scripts/setup.sh --compose` 相同）：

```sh
docker compose --profile local up -d --build
```

路径 B 和 C：

```sh
docker compose up -d --build
```

首次运行会构建镜像（安装依赖并构建 Web UI）并拉取镜像，这需要几分钟。为命令设置较长的超时时间，至少 15 分钟。如果你的工具限制了命令可以运行的时间（Claude Code 在前台允许 10 分钟），可以：

- 在后台运行启动命令，等待其退出，并检查其退出代码是否为 0，或
- 将其拆分为三个较短的命令，每个都有自己的超时时间。它们是为路径 A 显示的；在路径 B 和 C 上，省略 `--profile local`：

  ```sh
  docker compose --profile local pull --ignore-buildable
  docker compose build
  docker compose --profile local up -d
  ```

启动命令在容器启动后返回。此时应用可能尚未健康，模型可能仍在下载。

## 5. 等待其就绪

将以下内容作为一条命令运行，超时时间至少为 6 分钟：

```sh
PORT=$(sed -n 's/^PUBLIC_PORT=//p' .env | tail -n 1); PORT=${PORT:-3001}
end=$((SECONDS + 300)); ok=""
while [ "$SECONDS" -lt "$end" ]; do
  curl -fsS --max-time 5 "http://localhost:$PORT/api/health" 2>/dev/null && { ok=1; break; }
  sleep 5
done
if [ -n "$ok" ]; then printf '\nReady on port %s\n' "$PORT"; else echo "NOT READY after 5 minutes on port $PORT"; fi
```

它最多等待五分钟，并且总是以 `Ready on port …` 或 `NOT READY …` 结束。HTTP 200 且返回 `{"ok":true,"service":"helix-foundry"}` 意味着 API 已启动且 HelixDB 在启动时已响应，因为应用在开始监听之前会在 HelixDB 中初始化其 schema。首次启动时，应用和 worker 可能会在 HelixDB 仍在启动时退出并重启。Docker 会自动重启它们。

如果五分钟后仍未就绪，请收集状态